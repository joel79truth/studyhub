require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');
const { GoogleGenerativeAI } = require('@google/generative-ai');

// Supabase
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const supabase = createClient(supabaseUrl, supabaseServiceKey);

// Gemini – using 2.0 flash for higher free quota
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const model = genAI.getGenerativeModel({ model: 'models/gemini-2.0-flash' });

// Sleep helper to respect rate limits
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ------------------------------------------------------------
//  HELPER: get course_id + metadata for the prompt
// ------------------------------------------------------------
async function getCourseMetadata(fileId) {
  const { data: file, error: fileErr } = await supabase
    .from('files')
    .select('program, semester, course_name')
    .eq('id', fileId)
    .single();

  if (fileErr || !file) {
    console.warn(`   ⚠️ File ${fileId} not found.`);
    return null;
  }

  const programName = file.program.trim();
  const semester = file.semester;
  const originalCourseName = file.course_name.trim();

  // Remove emojis and special characters, collapse spaces, lowercase for matching
  const clean = (str) =>
    str
      .replace(/[^\w\s]/g, '')   // remove everything except letters, digits, spaces
      .replace(/\s+/g, ' ')      // collapse multiple spaces
      .trim()
      .toLowerCase();

  const fileCourseClean = clean(originalCourseName);

  // Find program id (for course matching)
  const { data: programs, error: progErr } = await supabase
    .from('programs')
    .select('id, name')
    .ilike('name', `%${programName}%`);

  let courseId = null;
  let matchedCourseName = originalCourseName;

  if (progErr || !programs || programs.length === 0) {
    console.warn(`   ⚠️ No program matching "${programName}".`);
  } else {
    const program = programs[0];
    const { data: courses, error: courseErr } = await supabase
      .from('courses')
      .select('id, course_name')
      .eq('program_id', program.id)
      .eq('semester', semester);

    if (!courseErr && courses && courses.length > 0) {
      // Normalise DB course names and compare
      const exact = courses.find(c => clean(c.course_name) === fileCourseClean);
      if (exact) {
        courseId = exact.id;
        matchedCourseName = exact.course_name;
      } else {
        const partial = courses.find(c => {
          const dbClean = clean(c.course_name);
          return dbClean.includes(fileCourseClean) || fileCourseClean.includes(dbClean);
        });
        if (partial) {
          courseId = partial.id;
          matchedCourseName = partial.course_name;
        }
      }
    }
  }

  return {
    courseId,
    programName,
    courseName: matchedCourseName,
    semester,
  };
}

// ------------------------------------------------------------
//  CHUNK QUALITY CHECK
// ------------------------------------------------------------
async function isChunkEducational(chunkContent) {
  const prompt = `
Is the following text educational content suitable for generating study questions?
Reply with a single word: YES or NO.
Text:
"""
${chunkContent.substring(0, 1000)}
"""`;

  try {
    const result = await model.generateContent(prompt);
    const text = result.response.text().trim().toUpperCase();
    return text === 'YES';
  } catch (e) {
    console.error('   Quality check failed, assuming YES');
    return true; // assume ok on error
  }
}

// ------------------------------------------------------------
//  GENERATE QUESTIONS FOR ONE CHUNK
// ------------------------------------------------------------
async function generateQuestionsForChunk(chunkId) {
  const { data: chunk, error } = await supabase
    .from('note_chunks')
    .select('id, content, heading, file_id, chunk_number')
    .eq('id', chunkId)
    .single();

  if (error || !chunk) {
    console.error(`❌ Chunk ${chunkId} not found`);
    return;
  }

  // 1. Already has questions?
  const { data: existing } = await supabase
    .from('generated_questions')
    .select('id')
    .eq('chunk_id', chunkId)
    .limit(1);
  if (existing && existing.length > 0) {
    console.log(`   Chunk ${chunkId} already has questions – skipping.`);
    return;
  }

  // 2. Quality pre‑check
  const educational = await isChunkEducational(chunk.content);
  if (!educational) {
    console.log(`   ⛔ Chunk ${chunkId} does not contain enough educational content – skipped.`);
    return;
  }

  // 3. Get course metadata (courseId, programName, etc.)
  const meta = await getCourseMetadata(chunk.file_id);
  const courseId = meta?.courseId || null;
  const programName = meta?.programName || 'Unknown Program';
  const courseName = meta?.courseName || 'Unknown Course';
  const semester = meta?.semester || '';

  // Source reference for later use
  const sourceRef = `${chunk.heading || 'Lecture'} (Chunk ${chunk.chunk_number})`;

  // ----------------------------------------------------------
  // 4. THE MAIN PROMPT (your exact specifications)
  // ----------------------------------------------------------
  const prompt = `
You are an expert university assessment designer.

Your task is to create high-quality, original assessment questions for StudyHub LUANAR.

The goal is to produce questions that resemble the style, depth, and academic quality of undergraduate university continuous assessments and final examinations, particularly those commonly used at LUANAR.

IMPORTANT RULES

1. Every question MUST be answerable ONLY from the lecture excerpt provided.
2. Do NOT introduce facts, formulas, definitions, or assumptions that are not supported by the lecture excerpt.
3. Do NOT copy or closely paraphrase existing examination questions.
4. Produce original questions only.
5. Cover different concepts from the lecture. Avoid testing the same concept repeatedly.
6. The wording should be formal, clear, and suitable for university students.
7. When appropriate to the subject, use realistic LUANAR or Malawian contexts (such as agriculture, livestock, fisheries, forestry, natural resources, or local examples). If the subject is not related, do not force Malawian examples.
8. Questions should test understanding rather than simple memorization whenever possible.
9. Every question must have only ONE correct answer.
10. Distractors must be realistic misconceptions that students commonly make.
11. Options should be concise (maximum 7 words each).
12. Generate between 3 and 8 questions depending on how much meaningful content exists in the lecture excerpt. If the excerpt contains very little educational content, return fewer questions instead of inventing information.

Course Information

Program:
${programName}

Course:
${courseName}

Semester:
${semester}

Lecture Heading:
${chunk.heading}

Learning Objectives

First identify the key learning objectives covered in this lecture excerpt.

Question Distribution

Aim for a balanced mix of Bloom's Taxonomy:

• Remember
• Understand
• Apply
• Analyze
• Evaluate (only if supported)

Difficulty Distribution

• Easy
• Medium
• Hard

Do not force an exact distribution if the lecture excerpt does not support it.

Question Quality

Questions should include a healthy mixture of:

• Conceptual questions
• Application questions
• Scenario-based questions
• Short case-study questions (when appropriate)
• Comparison questions
• Cause-and-effect questions

Avoid asking multiple questions with different wording but the same answer.

For every question generate:

- question
- option_a
- option_b
- option_c
- option_d
- answer
- explanation
- difficulty
- blooms_level
- hint
- sub_topic_tag
- confidence

Explanation Requirements

Explain:

• Why the correct answer is correct.
• Why the most likely incorrect choice is incorrect.

Keep explanations educational and concise.

Hint Requirements

Hints should guide students toward the answer without revealing it.

Sub-topic Tag

Provide a short concept label (1–3 words).

Examples:

- Photosynthesis
- Soil Texture
- Binary Trees
- Cell Division

Confidence

Return a confidence score between 0 and 1 indicating how confident you are that the question is fully supported by the lecture excerpt.

Before Returning

Verify that:

✓ Every answer is supported by the lecture excerpt.
✓ There is only one correct answer.
✓ The explanation matches the answer.
✓ Questions are not duplicates.
✓ JSON is valid.
✓ No markdown is included.

Return ONLY this JSON object:

{
  "learning_objectives": [
    "..."
  ],
  "questions": [
    {
      "question": "...",
      "option_a": "...",
      "option_b": "...",
      "option_c": "...",
      "option_d": "...",
      "answer": "A",
      "explanation": "...",
      "difficulty": "easy",
      "blooms_level": "remember",
      "hint": "...",
      "sub_topic_tag": "...",
      "confidence": 0.98
    }
  ]
}

Lecture Excerpt

"""
${chunk.content.substring(0, 3000)}
"""
`;

  // ----------------------------------------------------------
  // 5. CALL GEMINI & INSERT
  // ----------------------------------------------------------
  try {
    const result = await model.generateContent({
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      generationConfig: {
        maxOutputTokens: 2500,   // enough for 8 questions + objectives
        temperature: 0.4,
      },
    });

    let raw = result.response.text();
    raw = raw.replace(/```json|```/g, '').trim();
    const data = JSON.parse(raw);
    const questions = data.questions || [];
    const objectives = data.learning_objectives || [];

    let inserted = 0;
    for (const q of questions) {
      // Discard if confidence < 0.7
      if (q.confidence && parseFloat(q.confidence) < 0.7) {
        console.log(`   ⚠️ Low confidence (${q.confidence}), skipping.`);
        continue;
      }

      const { error: insertErr } = await supabase
        .from('generated_questions')
        .insert({
          chunk_id: chunk.id,
          course_id: courseId,
          question: q.question,
          option_a: q.option_a,
          option_b: q.option_b,
          option_c: q.option_c,
          option_d: q.option_d,
          answer: q.answer,
          explanation: q.explanation,
          difficulty: q.difficulty,
          blooms_level: q.blooms_level,
          sub_topic_tag: q.sub_topic_tag,
          learning_objectives: objectives,
          source_reference: sourceRef,
          hint: q.hint,
          confidence: q.confidence,
        });

      if (insertErr) {
        console.error(`   ❌ Insert error:`, insertErr.message);
      } else {
        inserted++;
      }
    }

    console.log(`   ✅ Inserted ${inserted} questions (${objectives.length} objectives) for chunk ${chunkId}`);
  } catch (err) {
    console.error(`   ❌ Gemini generation failed for chunk ${chunkId}:`, err.message);
    if (err.response) console.error('   Response:', err.response);
  }
}

// ------------------------------------------------------------
//  MAIN LOOP
// ------------------------------------------------------------
async function generateAllMissing() {
  const { data: allChunks } = await supabase.from('note_chunks').select('id');
  if (!allChunks) {
    console.log('No chunks found.');
    return;
  }

  const { data: existingQuestions } = await supabase
    .from('generated_questions')
    .select('chunk_id');

  const existingSet = new Set((existingQuestions || []).map(q => q.chunk_id));
  const missing = allChunks.filter(c => !existingSet.has(c.id));

  console.log(`Found ${missing.length} chunks without questions out of ${allChunks.length} total.`);

  for (let i = 0; i < missing.length; i++) {
    const chunk = missing[i];
    await generateQuestionsForChunk(chunk.id);

    // Respect free‑tier per‑minute limits (e.g., 5‑10 requests/min)
    // Adjust the delay as needed – 3 seconds is safe.
    if (i < missing.length - 1) {
      console.log(`   ⏳ Waiting 3 seconds before next chunk...`);
      await sleep(3000);
    }
  }

  console.log('🎉 All chunks processed.');
}

generateAllMissing().catch(console.error);