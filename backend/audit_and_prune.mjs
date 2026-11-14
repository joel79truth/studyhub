import dotenv from 'dotenv';
dotenv.config();
import { createClient } from '@supabase/supabase-js';
import fs from 'fs';
import path from 'path';

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

async function checkUrl(url) {
  if (!url) return { ok: false, status: 0, reason: 'Empty URL' };
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 3500);
    const res = await fetch(url, { method: 'HEAD', signal: controller.signal });
    clearTimeout(timeout);
    return { ok: res.status === 200, status: res.status };
  } catch (err) {
    return { ok: false, status: 500, error: err.message };
  }
}

// Concurrency pool helper
async function mapConcurrent(items, concurrency, fn) {
  const results = new Array(items.length);
  let index = 0;
  const workers = Array.from({ length: concurrency }, async () => {
    while (index < items.length) {
      const i = index++;
      results[i] = await fn(items[i], i);
    }
  });
  await Promise.all(workers);
  return results;
}

async function audit() {
  console.log('=== AUDITING STORAGE & DATABASE TABLES ===');

  // 1. Audit notes table
  const { data: notes, error: notesErr } = await supabase.from('notes').select('*');
  if (notesErr) {
    console.error('Error fetching notes:', notesErr);
    return;
  }
  console.log(`Fetched ${notes.length} total rows from 'notes'. Checking storage in parallel (concurrency 20)...`);

  let completedNotes = 0;
  const noteResults = await mapConcurrent(notes, 20, async (note, i) => {
    let keep = false;
    let status = 200;

    if (note.storage_type === 'gdrive') {
      keep = true;
    } else {
      let testUrl = note.url;
      if (!testUrl && note.filepath) {
        const { data } = supabase.storage.from(process.env.SUPABASE_BUCKET || 'notes').getPublicUrl(note.filepath);
        testUrl = data.publicUrl;
      }
      const check = await checkUrl(testUrl);
      keep = check.ok;
      status = check.status;
    }

    completedNotes++;
    if (completedNotes % 25 === 0 || completedNotes === notes.length) {
      process.stdout.write(`Notes: ${completedNotes}/${notes.length}\r`);
    }
    return { note, keep, status };
  });

  const notesToKeep = noteResults.filter(r => r.keep).map(r => r.note);
  const notesToRemove = noteResults.filter(r => !r.keep).map(r => ({ ...r.note, checkStatus: r.status }));

  console.log(`\nNotes scan done: ${notesToKeep.length} to keep, ${notesToRemove.length} to prune.`);

  // 2. Audit past_paper table
  const { data: pastPapers, error: ppErr } = await supabase.from('past_paper').select('*');
  if (ppErr) {
    console.error('Error fetching past_paper:', ppErr);
    return;
  }
  console.log(`Fetched ${pastPapers.length} total rows from 'past_paper'. Checking storage in parallel (concurrency 20)...`);

  let completedPapers = 0;
  const paperResults = await mapConcurrent(pastPapers, 20, async (paper, i) => {
    let keep = false;
    let status = 200;

    if (paper.file_url) {
      const check = await checkUrl(paper.file_url);
      keep = check.ok;
      status = check.status;
    }

    completedPapers++;
    if (completedPapers % 20 === 0 || completedPapers === pastPapers.length) {
      process.stdout.write(`Past papers: ${completedPapers}/${pastPapers.length}\r`);
    }
    return { paper, keep, status };
  });

  const papersToKeep = paperResults.filter(r => r.keep).map(r => r.paper);
  const papersToRemove = paperResults.filter(r => !r.keep).map(r => ({ ...r.paper, checkStatus: r.status }));

  console.log(`\nPast papers scan done: ${papersToKeep.length} to keep, ${papersToRemove.length} to prune.`);

  // Save backup
  const backupDir = path.resolve('../migration_data');
  if (!fs.existsSync(backupDir)) fs.mkdirSync(backupDir, { recursive: true });

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backupFile = path.join(backupDir, `pruned_rows_backup_${timestamp}.json`);

  fs.writeFileSync(backupFile, JSON.stringify({
    timestamp: new Date().toISOString(),
    notesToRemove,
    papersToRemove,
    notesKeptCount: notesToKeep.length,
    papersKeptCount: papersToKeep.length
  }, null, 2));

  console.log(`Backup of rows to remove saved to: ${backupFile}`);

  return {
    notesToRemove,
    papersToRemove,
    backupFile
  };
}

const isExecute = process.argv.includes('--execute');

audit().then(async (res) => {
  if (!res) return;
  if (!isExecute) {
    console.log('\nDRY-RUN COMPLETE. No rows deleted.');
    console.log('Run with --execute to delete the missing rows from Supabase.');
    return;
  }

  console.log('\n=== EXECUTING PRUNE ===');
  
  // 1. Prune notes
  if (res.notesToRemove.length > 0) {
    const noteIds = res.notesToRemove.map(n => n.id);
    console.log(`Deleting ${noteIds.length} missing rows from 'notes'...`);
    for (let i = 0; i < noteIds.length; i += 50) {
      const batch = noteIds.slice(i, i + 50);
      const { error } = await supabase.from('notes').delete().in('id', batch);
      if (error) {
        console.error(`Error deleting notes batch ${i}:`, error.message);
      }
    }
    console.log('Notes prune finished.');
  }

  // 2. Prune past papers (and their child foreign key rows in paper_documents & paper_questions)
  if (res.papersToRemove.length > 0) {
    const paperIds = res.papersToRemove.map(p => p.id);
    console.log(`Deleting child records and ${paperIds.length} missing rows from 'past_paper'...`);

    for (let i = 0; i < paperIds.length; i += 50) {
      const batch = paperIds.slice(i, i + 50);
      
      // Clean paper_documents if referencing paper_id
      await supabase.from('paper_documents').delete().in('paper_id', batch);
      // Clean paper_questions referencing paper_id
      await supabase.from('paper_questions').delete().in('paper_id', batch);
      // Now delete from past_paper
      const { error } = await supabase.from('past_paper').delete().in('id', batch);
      if (error) {
        console.error(`Error deleting past_paper batch ${i}:`, error.message);
      }
    }
    console.log('Past papers prune finished.');
  }

  console.log('=== PRUNE COMPLETED SUCCESSFULLY! ===');
}).catch(console.error);
