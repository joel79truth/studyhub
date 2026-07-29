// utils/studentContext.js
import { supabaseAdmin } from '../lib/supabase.js'; // your admin client

export async function getStudentContext(userId) {
  // 1. Profile
  const { data: profile } = await supabaseAdmin
    .from('profiles')
    .select('programme, name')
    .eq('id', userId)
    .single();

  // 2. Courses – assuming table `student_courses` with `course_name`
  const { data: coursesData } = await supabaseAdmin
    .from('student_courses')
    .select('course_name')
    .eq('user_id', userId);

  const courses = coursesData?.map(c => c.course_name) || [];

  // 3. Weaknesses
  const { data: weaknessesData } = await supabaseAdmin
    .from('student_weaknesses')
    .select('weakness')
    .eq('user_id', userId);

  const weaknesses = weaknessesData?.map(w => w.weakness) || [];

  // 4. Past papers – extract short summaries from text content
  const { data: papers } = await supabaseAdmin
    .from('past_papers')
    .select('content, course_name')
    .in('course_name', courses)
    .limit(3);

  const paperSummaries = papers?.map(p => 
    p.content.substring(0, 300) + '...'
  ).join('\n\n') || '';

  return {
    programme: profile?.programme || '',
    name: profile?.name || '',
    courses,
    weaknesses,
    paperSummaries,
  };
}