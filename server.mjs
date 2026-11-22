import { createServer } from 'node:http';
import { readFile, access } from 'node:fs/promises';
import { constants } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const envPath = join(here, '.env');

try {
  await access(envPath, constants.R_OK);
  const envText = await readFile(envPath, 'utf8');
  for (const line of envText.split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (match && !process.env[match[1]]) process.env[match[1]] = match[2].replace(/^['"]|['"]$/g, '');
  }
} catch {}

const port = Number(process.env.PORT || 4173);
const host = process.env.HOST || '127.0.0.1';

const responseSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    title: { type: 'string' },
    student_summary: { type: 'string' },
    strategy: { type: 'string' },
    yearly_plan: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          grade: { type: 'integer', enum: [9, 10, 11, 12] },
          year_name: { type: 'string' },
          theme: { type: 'string' },
          steps: {
            type: 'array',
            items: {
              type: 'object',
              additionalProperties: false,
              properties: {
                timing: { type: 'string' },
                action: { type: 'string' },
                why: { type: 'string' },
                success_measure: { type: 'string' }
              },
              required: ['timing', 'action', 'why', 'success_measure']
            }
          }
        },
        required: ['grade', 'year_name', 'theme', 'steps']
      }
    },
    follow_up_questions: { type: 'array', items: { type: 'string' } },
    assumptions: { type: 'array', items: { type: 'string' } }
  },
  required: ['title', 'student_summary', 'strategy', 'yearly_plan', 'follow_up_questions', 'assumptions']
};

const instructions = `You are a thoughtful college and career planning coach for high-school students. Your job is to interpret the student's full profile and create useful advice, not repeat answers or fill a generic template.

Read every selection and free-text answer. Identify what the student wants, what they already do, what seems to interest them, what constraints they mentioned, and what remains uncertain. Connect those details to a practical strategy and concrete actions. Explain briefly why each action fits this student and what observable progress would look like.

Create exactly one plan section for each grade 9, 10, 11, and 12. Use 2 to 4 specific steps per year, each with a realistic timing (such as this month, this semester, or before senior-year applications), an action the student can actually take, a short reason tied to their profile, and a measurable sign of progress. Sequence the steps so earlier exploration informs later choices. Tailor the current grade especially closely to the student's classes, activities, goals, interests, and schedule.

Do not equate prestige or selectivity with quality or fit. If a student wants ambitious college options, help them prepare while also preserving strong-fit alternatives. Treat clubs and activities as ways to learn, contribute, and develop skills; never promise that a title or activity guarantees admission. If the student is undecided, recommend small experiments and keep multiple paths open rather than forcing a career choice.

Do not invent specific school graduation rules, course names, college requirements, deadlines, or admission chances. The website does not provide verified school-policy sources in this request. If a step depends on local policy, say what needs to be checked and with which official source. Make a useful provisional plan even when answers are missing, and list only the most important follow-up questions (at most 3). Avoid sensitive assumptions. Use encouraging, plain language appropriate for a teenager. Never reveal hidden reasoning; give concise explanations in the requested fields. Return only the required structured output.`;

function sendJson(response, status, value) {
  const body = JSON.stringify(value);
  response.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff'
  });
  response.end(body);
}

async function readJson(request, maxBytes = 24_000) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > maxBytes) throw new Error('The profile is too large.');
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

function cleanString(value, max = 700) {
  return typeof value === 'string' ? value.trim().slice(0, max) : '';
}

function cleanList(value, maxItems = 15) {
  return Array.isArray(value) ? value.slice(0, maxItems).map(item => cleanString(item, 160)).filter(Boolean) : [];
}

function normalizeProfile(profile) {
  if (!profile || typeof profile !== 'object' || Array.isArray(profile)) throw new Error('Please complete the student profile first.');
  const normalized = {
    grade: cleanString(profile.grade, 80),
    school: cleanString(profile.school, 160),
    academic: cleanString(profile.academic, 160),
    courses: cleanString(profile.courses),
    subjects: cleanList(profile.subjects),
    interestNotes: cleanString(profile.interestNotes),
    activities: cleanList(profile.activities),
    activityDetails: cleanString(profile.activityDetails),
    destination: cleanString(profile.destination, 160),
    career: cleanString(profile.career),
    whyCollege: cleanString(profile.whyCollege),
    highSchoolGoal: cleanString(profile.highSchoolGoal),
    priorities: cleanList(profile.priorities),
    help: cleanList(profile.help),
    barriers: cleanList(profile.barriers)
  };
  if (!normalized.grade) throw new Error('Choose your current grade to build a year-by-year plan.');
  return normalized;
}

function extractOutputText(data) {
  for (const item of data.output || []) {
    if (item.type !== 'message') continue;
    for (const content of item.content || []) {
      if (content.type === 'refusal') throw new Error('The AI could not generate a plan from these answers. Please edit the profile and try again.');
      if (content.type === 'output_text' && content.text) return content.text;
    }
  }
  throw new Error('The AI did not return a complete plan. Please try again.');
}

function validatePlan(plan) {
  if (!plan || !Array.isArray(plan.yearly_plan)) throw new Error('The AI returned an incomplete roadmap. Please try again.');
  const grades = new Set(plan.yearly_plan.map(item => item.grade));
  if (![9, 10, 11, 12].every(grade => grades.has(grade))) throw new Error('The AI roadmap is missing a school year. Please try again.');
  for (const year of plan.yearly_plan) {
    if (!Array.isArray(year.steps) || year.steps.length < 2) throw new Error('The AI returned too few steps for one of the school years. Please try again.');
  }
  return plan;
}

async function generatePlan(profile) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    const error = new Error('AI is not connected yet. Add an API key to the private .env file, then restart the planner.');
    error.status = 503;
    throw error;
  }
  const payload = {
    model: process.env.OPENAI_MODEL || 'gpt-6.2-sol',
    store: false,
    instructions,
    input: `Create a personalized college and career roadmap from this student profile.\n\n${JSON.stringify(profile)}`,
    text: {
      format: {
        type: 'json_schema',
        name: 'student_roadmap',
        strict: true,
        schema: responseSchema
      }
    }
  };
  const response = await fetch('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(90_000)
  });
  if (!response.ok) {
    if (response.status === 401) throw new Error('The AI service rejected the server key. Check the key in .env.');
    if (response.status === 429) throw new Error('The AI service is busy or the project has reached a usage limit. Try again later.');
    throw new Error(`The AI service could not create a plan (HTTP ${response.status}). Try again.`);
  }
  const data = await response.json();
  return validatePlan(JSON.parse(extractOutputText(data)));
}

const server = createServer(async (request, response) => {
  const url = new URL(request.url, `http://${request.headers.host || 'localhost'}`);
  if (request.method === 'GET' && url.pathname === '/api/status') {
    return sendJson(response, 200, { configured: Boolean(process.env.OPENAI_API_KEY) });
  }
  if (request.method === 'POST' && url.pathname === '/api/generate-plan') {
    try {
      const body = await readJson(request);
      const profile = normalizeProfile(body.profile);
      const plan = await generatePlan(profile);
      return sendJson(response, 200, { plan });
    } catch (error) {
      const status = error.status || (error instanceof SyntaxError ? 400 : 502);
      return sendJson(response, status, { error: error.message || 'Unable to create a plan.' });
    }
  }
  if (request.method === 'GET' && (url.pathname === '/' || url.pathname === '/index.html')) {
    try {
      const page = await readFile(join(here, 'index.html'));
      response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Content-Length': Buffer.byteLength(page), 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
      return response.end(page);
    } catch {
      return sendJson(response, 500, { error: 'The planner page could not be loaded.' });
    }
  }
  sendJson(response, 404, { error: 'Not found.' });
});

server.listen(port, host, () => {
  console.log(`College Planner running at http://${host}:${port}`);
  if (!process.env.OPENAI_API_KEY) console.log('AI is not configured. Add OPENAI_API_KEY to .env to enable plan generation.');
});
