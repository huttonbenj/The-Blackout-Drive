/**
 * The Blackout Drive — Catalog Worker
 * Cloudflare Worker that reads the R2 bucket structure and returns
 * a dynamic catalog JSON. Folder = category. Files = content items.
 *
 * Bind your R2 bucket to this worker as:
 *   Variable name: BUCKET
 *   Bucket: blackout-drive-content
 *
 * Deploy URL becomes the remoteCatalogUrl in config.json.
 */

const PUBLIC_BASE = 'https://pub-04e18483c8444717b2d33ec2fff64722.r2.dev';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

// Human-readable name overrides for folder IDs
const FOLDER_NAMES = {
  'survival':     'Survival & Field Craft',
  'medical':      'Trauma & Medicine',
  'preparedness': 'Tactical & Security',
  'classics':     'History & Philosophy',
  'law':          'Governance & Law',
  'faith':        'Theology & Classics',
  'homestead':    'Food & Agriculture',
  'science':      'Applied Sciences',
  'communication':'Comms & Navigation',
  'technology':   'Engineering & Mechanics',
};

// Human-readable name overrides for individual filenames (without extension)
const FILE_NAMES = {
  // Survival
  'army_fm21-76_survival_1992':   'US Army Survival Manual (FM 21-76, 1992)',
  'army_fm3-05-70_survival_2002': 'US Army Survival Manual (FM 3-05.70, 2002)',
  'woodcraft_camping':            'Woodcraft and Camping (1920)',
  'camp_lore_woodcraft':          'The Book of Camp-Lore and Woodcraft (1920)',
  'how_to_camp_out':              'How to Camp Out (1877)',
  'knots_and_splices':            'Knots, Splices and Rope Work (1896)',
  'shelters_shacks_shanties':     'Shelters, Shacks, and Shanties (1914)',
  'the_boy_mechanic':             'The Boy Mechanic: 700 Things for Boys to Do (1913)',
  'knots_splices_rope_work':      'Knots, Splices and Rope Work (1912)',
  // Medical
  'merck_materia_medica':         'Merck\u2019s Manual of Materia Medica (1899)',
  'home_medical_library':         'Home Medical Library — Vol. 1: Emergencies',
  'household_medicine':           'Health on the Farm: Rural Sanitation & Hygiene (1910)',
  'manual_surgery_operations':    'A Manual of the Operations of Surgery (1889)',
  'where_there_is_no_doctor':     'Where There Is No Doctor',
  'where_there_is_no_dentist':    'Where There Is No Dentist',
  'fema_are_you_ready':           'FEMA Are You Ready Guide',
  'mercks_1899_manual':           'Merck\u2019s Manual of the Materia Medica (1899)',
  'notes_on_nursing':             'Notes on Nursing — Florence Nightingale (1860)',
  // Homestead
  'culpeper_herbal':              'Culpeper\u2019s Complete Herbal (1653)',
  'ten_acres_enough':             'Ten Acres Enough (1864)',
  'manual_of_gardening':          'Manual of Gardening (1910)',
  'home_vegetable_gardening':     'Home Vegetable Gardening (1911)',
  'langstroth_beekeeping':        'Langstroth on the Hive and the Honey-Bee (1853)',
  'soil_nature_uses':             'Farmers of Forty Centuries: Permanent Agriculture (1911)',
  'american_frugal_housewife':    'The American Frugal Housewife (1832)',
  'compleat_herbal':              'Culpeper\u2019s Complete Herbal (1653)',
  'farmers_of_forty_centuries':   'Farmers of Forty Centuries (1911)',
  'preservation_of_food_1919':    'Preservation of Food (1919)',
  // Engineering & Mechanics
  'boy_electrician':              'The Boy Electrician (1913)',
  'farm_mechanics':               'Farm Mechanics (1922)',
  'machine_shop_practice':        'Machine Shop Practice (1919)',
  'practical_mechanics':          'Practical Mechanics for Boys',
  'woodwork_joints':              'Woodwork Joints: How They Are Set Out and Made',
  // Law
  'us_constitution':              'United States Constitution',
  'declaration_of_independence':  'Declaration of Independence (1776)',
  'magna_carta':                  'Magna Carta (1215)',
  'blacks_law_dictionary_1910':   'Blackstone\u2019s Commentaries on the Laws of England',
  'federalist_papers':            'The Federalist Papers',
  'common_sense_paine':           'Common Sense — Thomas Paine (1776)',
  // Philosophy
  'meditations_marcus_aurelius':  'Meditations — Marcus Aurelius',
  'enchiridion_epictetus':        'Enchiridion — Epictetus',
  'art_of_war':                   'The Art of War — Sun Tzu',
  'plato_republic':               'The Republic — Plato',
  'seneca_moral_letters':         'Seneca\u2019s Morals: Of a Happy Life & Clemency',
  'walden_thoreau':               'Walden — Henry David Thoreau (1854)',
  // Classics (duplicates with different filenames)
  'meditations':                  'Meditations — Marcus Aurelius',
  'art-of-war':                   'The Art of War — Sun Tzu',
  'the-republic':                 'The Republic — Plato',
  'enchiridion':                  'Enchiridion — Epictetus',
  'common-sense':                 'Common Sense — Thomas Paine',
  'us-constitution':              'United States Constitution',
  // Bible
  'bible_kjv':                    'The Holy Bible — King James Version (KJV)',
  'bible_web':                    'The Holy Bible — World English Bible (WEB)',
  'bible_asv':                    'The Holy Bible — American Standard Version (ASV)',
  'bible_ylt':                    'The Holy Bible — Young\u2019s Literal Translation (YLT)',
};

function formatName(str) {
  return str
    .replace(/[-_]/g, ' ')
    .replace(/\bfm\b/gi, 'FM')
    .replace(/\bfema\b/gi, 'FEMA')
    .replace(/\busa?\b/gi, 'US')
    .replace(/\b\w/g, c => c.toUpperCase())
    .trim();
}

export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: CORS });
    }

    try {
      // List all objects (up to 1000 — enough for foreseeable future)
      const listed = await env.BUCKET.list({ limit: 1000 });
      const packs = {};

      for (const obj of listed.objects) {
        const key = obj.key;

        // Skip hidden/meta files
        const parts = key.split('/');
        if (parts.some(p => p.startsWith('_') || p.startsWith('.'))) continue;

        // Only support pdf, epub, txt
        const ext = key.split('.').pop().toLowerCase();
        if (!['pdf', 'epub', 'txt'].includes(ext)) continue;

        // Determine folder (category) and filename
        let folder, filename;
        if (parts.length >= 2) {
          folder = parts[0];
          filename = parts.slice(1).join('/');
        } else {
          folder = 'general';
          filename = key;
        }

        if (!packs[folder]) {
          packs[folder] = {
            id: folder,
            name: FOLDER_NAMES[folder] || formatName(folder),
            description: '',
            files: [],
          };
        }

        const nameWithoutExt = filename.replace(/\.[^.]+$/, '');
        const safeId = `${folder}-${nameWithoutExt}`.replace(/[^a-z0-9-]/gi, '-').toLowerCase();

        packs[folder].files.push({
          id: safeId,
          name: FILE_NAMES[nameWithoutExt] || formatName(nameWithoutExt),
          filename,
          type: ext,
          url: `${PUBLIC_BASE}/${key}`,
          size: obj.size,
          uploaded: obj.uploaded,
        });
      }

      // Load optional _meta.json per folder for description/icon/price overrides
      for (const packId of Object.keys(packs)) {
        try {
          const meta = await env.BUCKET.get(`${packId}/_meta.json`);
          if (meta) {
            const m = await meta.json();
            if (m.name)        packs[packId].name        = m.name;
            if (m.description) packs[packId].description = m.description;
            if (m.icon)        packs[packId].icon         = m.icon;
            if (m.price)       packs[packId].price        = m.price;
          }
        } catch (_) { /* _meta.json is optional */ }
      }

      const catalog = {
        version: 1,
        generated: new Date().toISOString(),
        source: 'cloudflare-worker',
        packs: Object.values(packs).filter(p => p.files.length > 0),
      };

      return new Response(JSON.stringify(catalog, null, 2), {
        headers: {
          ...CORS,
          'Content-Type': 'application/json',
          'Cache-Control': 'public, max-age=300',
        },
      });

    } catch (err) {
      return new Response(JSON.stringify({ error: err.message }), {
        status: 500,
        headers: { ...CORS, 'Content-Type': 'application/json' },
      });
    }
  },
};
