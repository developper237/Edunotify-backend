// services/auth-service/src/utils/storage.js
// Stockage permanent via Supabase Storage, avec repli sur le disque
// local (dev) si SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY ne sont pas définis.
const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const path = require('path');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const SUPABASE_BUCKET = process.env.SUPABASE_BUCKET || 'smartcampus';

const supabase =
  SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY
    ? createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
        auth: { persistSession: false },
      })
    : null;

const urlPublique = (chemin) =>
  `${SUPABASE_URL}/storage/v1/object/public/${SUPABASE_BUCKET}/${chemin}`;

// Upload d'un buffer → URL publique Supabase (ou chemin local en repli)
async function uploadFichier({ buffer, nom, dossier, contentType }) {
  const chemin = `${dossier}/${nom}`;
  if (supabase) {
    const { error } = await supabase.storage.from(SUPABASE_BUCKET).upload(chemin, buffer, {
      upsert: true,
      contentType: contentType || 'application/octet-stream',
    });
    if (error) throw new Error(`Supabase upload: ${error.message}`);
    return urlPublique(chemin);
  }
  // Repli local (dev) : l'URL relative est servie par /uploads
  const dir = path.join(__dirname, '../../uploads', dossier);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, nom), buffer);
  return `/uploads/${dossier}/${nom}`;
}

// Supprime un fichier (Supabase si URL publique, sinon disque local)
async function supprimerFichier(url) {
  if (!url) return;
  if (supabase && url.startsWith(SUPABASE_URL)) {
    const marker = `/object/public/${SUPABASE_BUCKET}/`;
    const idx = url.indexOf(marker);
    if (idx >= 0) {
      const chemin = url.slice(idx + marker.length);
      try {
        await supabase.storage.from(SUPABASE_BUCKET).remove([chemin]);
      } catch (e) {
        console.warn('[Storage] Supabase remove:', e.message);
      }
    }
    return;
  }
  // Repli local
  try {
    const rel = url.replace(/^https?:\/\/[^/]+/, '');
    if (rel.startsWith('/uploads/')) {
      const filePath = path.join(__dirname, '../..', rel);
      if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    }
  } catch (e) { /* ignore */ }
}

module.exports = { uploadFichier, supprimerFichier, supabaseDisponible: !!supabase };
