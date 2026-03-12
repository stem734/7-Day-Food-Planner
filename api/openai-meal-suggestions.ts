import OpenAI from 'openai'

type HandlerRequest = {
  method?: string
  body?: unknown
}

type HandlerResponse = {
  status: (code: number) => HandlerResponse
  setHeader: (name: string, value: string) => HandlerResponse
  end: (body?: string) => void
}

function jsonResponse(res: HandlerResponse, status: number, body: unknown) {
  res.status(status).setHeader('Content-Type', 'application/json')
  res.end(JSON.stringify(body))
}

function extractJson(text: string) {
  const trimmed = text.trim()
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/)
  const candidate = fenced ? fenced[1] : trimmed
  const start = candidate.indexOf('[')
  const end = candidate.lastIndexOf(']')

  if (start === -1 || end === -1) {
    throw new Error('Model response did not contain a JSON array.')
  }

  return JSON.parse(candidate.slice(start, end + 1))
}

export default async function handler(req: HandlerRequest, res: HandlerResponse) {
  if (req.method !== 'POST') {
    return jsonResponse(res, 405, { error: 'Method not allowed.' })
  }

  if (!process.env.OPENAI_API_KEY) {
    return jsonResponse(res, 500, {
      error: 'OPENAI_API_KEY is not configured on the server.',
    })
  }

  try {
    const { inventory, family, householdNeeds } = (req.body as {
      inventory?: unknown
      family?: unknown
      householdNeeds?: unknown
    }) ?? {}

    const client = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY,
    })

    const prompt = `
You are a family meal planner. Create 7 dinner ideas in JSON only.

Household dietary requirements:
${JSON.stringify({ family, householdNeeds }, null, 2)}

Available inventory:
${JSON.stringify(inventory, null, 2)}

Return a JSON array with exactly 7 objects. Each object must contain:
- day
- title
- summary
- servings
- cookTime
- dietaryNotes (array of strings)
- usesFromInventory (array of strings)
- shoppingNeeded (array of strings)
- ingredients (array of strings)
- steps (array of 4 to 6 concise cooking steps)
- nutritionFocus
- whyItFits

Rules:
- Prefer meals that use the inventory first.
- Respect dietary needs and avoidances.
- Make the meals feel practical and family-friendly.
- Keep ingredients and steps realistic for a home cook.
- Output JSON only with no markdown.
`.trim()

    const response = await client.responses.create({
      model: 'gpt-5-mini',
      input: prompt,
    })

    const meals = extractJson(response.output_text ?? '')

    return jsonResponse(res, 200, { meals })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'OpenAI request failed.'
    return jsonResponse(res, 500, { error: message })
  }
}
