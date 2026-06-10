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
  'survival':      'Survival & Field Craft',
  'medical':       'Medical & First Aid',
  'preparedness':  'Emergency Preparedness',
  'classics':      'History & Philosophy',
  'law':           'Law & Founding Documents',
  'faith':         'Theology & Classics',
  'homestead':     'Homesteading & Agriculture',
  'science':       'Applied Sciences',
  'communication': 'Communication & Navigation',
  'technology':    'Engineering & Mechanics',
  'engineering':   'Engineering & Mechanics',
  'cybersecurity': 'Systems & Cybersecurity',
  'development':   'Software & Development',
  'heritage':      'Foundational Wisdom & Heritage',
  'bible':         'The Bible',
  'psychology':    'Psychology & Leadership',
  'history':       'History & Civilization',
  'economics':     'Economics & Trade',
  'language':      'Language & Writing',
  'philosophy':    'Philosophy & Ethics',
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
  // Medical (new)
  'grays_anatomy_1918':           'Gray\u2019s Anatomy (1918)',
  'first_aid_red_cross_1913':     'Red Cross First Aid Manual (1913)',
  'manual_of_surgery_1889':       'A Manual of the Operations of Surgery (1889)',
  'household_medicine_1901':      'Household Medicine & Hygiene (1901)',
  'anatomy_descriptive_surgical': 'Anatomy: Descriptive and Surgical',
  'materia_medica_therapeutics':  'Materia Medica and Therapeutics',
  'diseases_of_the_heart':        'Diseases of the Heart (1908)',
  'emergency_childbirth_manual':  'Emergency Childbirth Manual',
  // Survival (new)
  'how_to_camp_out_1877':         'How to Camp Out (1877)',
  'tracks_and_tracking_1909':     'Tracks and Tracking (1909)',
  'on_the_trail_1911':            'On the Trail: An Outdoor Book for Girls (1911)',
  'scouting_for_boys_1908':       'Scouting for Boys (1908)',
  'two_years_before_mast':        'Two Years Before the Mast (1840)',
  'complete_guide_trapping':      'Complete Guide to Trapping',
  // Homestead (new)
  'soil_culture_1908':            'Soil Culture (1908)',
  'backyard_poultry_keeping':     'Backyard Poultry Keeping',
  'home_vegetable_garden_1911':   'Home Vegetable Gardening (1911)',
  // Engineering (new)
  'elementary_electricity':       'Elementary Electricity',
  'mechanical_drawing_1917':      'Mechanical Drawing (1917)',
  'concrete_construction_1910':   'Concrete Construction (1910)',
  'blacksmithing_1889':           'Blacksmithing (1889)',
  'carpentry_and_building_1899':  'Carpentry and Building (1899)',
  // Communication & Navigation
  'radio_amateurs_handbook':      'The Radio Amateur\'s Hand Book — A. Frederick Collins',
  'wireless_telegraphy_explained': 'Wireless Telegraphy and Telephony Simply Explained — Morgan',
  'masters_of_space':             'Masters of Space: Morse and the Telegraph — Towers',
  'letters_radio_engineer':       'Letters of a Radio-Engineer to His Son — John Mills',
  'kedge_anchor_sailors_assistant': 'The Kedge-Anchor: Young Sailors\' Assistant — Brady',
  // Law (new)
  'rights_of_man_paine':          'Rights of Man — Thomas Paine (1791)',
  'spirit_of_laws_montesquieu':   'The Spirit of the Laws — Montesquieu (1748)',
  'democracy_in_america_tocqueville': 'Democracy in America — Tocqueville (1835)',
  // Science (new category)
  'natural_theology_paley':       'Natural Theology — William Paley (1802)',
  'popular_astronomy_ball':       'A Popular History of Astronomy — Robert Ball',
  'chemical_history_candle_faraday': 'The Chemical History of a Candle — Faraday',
  'elements_of_chemistry_lavoisier': 'Elements of Chemistry — Lavoisier (1789)',
  'principia_newton':             'Principia Mathematica — Newton',
  'relativity_einstein':          'Relativity — Einstein (1920)',
  'experimental_researches_faraday': 'Experimental Researches in Electricity — Faraday',
  'treatise_on_electricity_maxwell': 'A Treatise on Electricity and Magnetism — Maxwell',
  'astronomy_with_opera_glass':   'Astronomy with an Opera-Glass (1888)',
  'dialogue_two_sciences_galileo': 'Dialogues Concerning Two New Sciences — Galileo',
  // Psychology (new category)
  'psychology_william_james':     'The Principles of Psychology — William James',
  'crowd_gustave_le_bon':         'The Crowd: A Study of the Popular Mind — Le Bon',
  'self_help_samuel_smiles':      'Self-Help — Samuel Smiles (1859)',
  'characters_theophrastus':      'Characters — Theophrastus (300 BC)',
  'influence_of_mind_on_body':    'Influence of the Mind on the Body',
  'art_of_public_speaking':       'The Art of Public Speaking',
  'how_to_analyze_people':        'How to Analyze People on Sight',
  'instinct_of_workmanship_veblen': 'The Instinct of Workmanship — Veblen',
  'will_to_believe_william_james': 'The Will to Believe — William James',
  'human_nature_politics':        'Human Nature in Politics (1908)',
  // History (new category)
  'up_from_slavery_washington':   'Up From Slavery — Booker T. Washington (1901)',
  'memoirs_us_grant':             'Personal Memoirs of U.S. Grant',
  'oregon_trail_parkman':         'The Oregon Trail — Francis Parkman (1849)',
  'narrative_frederick_douglass': 'Narrative of the Life of Frederick Douglass (1845)',
  'history_peloponnesian_war':    'History of the Peloponnesian War — Thucydides',
  'histories_herodotus':          'The Histories — Herodotus',
  'prince_machiavelli':           'The Prince — Machiavelli (1513)',
  'autobiography_benjamin_franklin': 'Autobiography of Benjamin Franklin',
  'plutarch_lives':                'Lives of the Noble Greeks and Romans — Plutarch',
  'leviathan_hobbes':             'Leviathan — Thomas Hobbes (1651)',
  // Preparedness (new category)
  'camp_and_trail_1920':          'Camp and Trail (1920)',
  'food_preservation_1919':       'Food Preservation (1919)',
  'fires_and_fire_fighters':      'Fires and Firefighters',
  'sanitation_practical':         'Practical Sanitation',
  'household_emergencies':        'Household Emergencies',
  'safe_water_guide':             'Safe Water Guide',
  'manual_of_military_training':  'Manual of Military Training (1917)',
  'ambulance_and_first_aid':      'Ambulance Work and First Aid',
  'defense_of_the_home':          'Defense of the Home',
  'outdoor_life_and_camping':     'Outdoor Life and Camping',
  // Economics (new category)
  'wealth_of_nations_vol1':       'The Wealth of Nations — Adam Smith (1776)',
  'theory_of_moral_sentiments':   'The Theory of Moral Sentiments — Adam Smith',
  'lombard_street_bagehot':       'Lombard Street — Walter Bagehot (1873)',
  'essays_on_political_economy':  'Essays on Political Economy — Bastiat',
  'principles_of_economics_marshall': 'Principles of Economics — Marshall (1890)',
  'theory_of_leisure_class_veblen': 'The Theory of the Leisure Class — Veblen (1899)',
  'essay_population_malthus':     'An Essay on the Principle of Population — Malthus (1798)',
  'road_to_serfdom_precursors':   'The Law — Frédéric Bastiat (1850)',
  'economic_consequences_peace':  'Economic Consequences of the Peace — Keynes (1919)',
  // Language (new category)
  'elements_of_style_strunk':     'The Elements of Style — Strunk (1918)',
  'rhetoric_aristotle':           'Rhetoric — Aristotle',
  'english_grammar_composition':  'English Grammar and Composition',
  'how_to_speak_and_write':       'How to Speak and Write Correctly',
  'on_the_art_of_writing':        'On the Art of Writing (1916)',
  'practical_english_composition': 'Practical English Composition',
  'spanish_grammar_1919':         'Spanish Grammar (1919)',
  'french_conversation_grammar':  'French Conversation Grammar',
  'latin_for_beginners':          'Latin for Beginners',
  'manual_of_english_grammar':    'Manual of English Grammar',
  // Bible (fill pass)
  'bible_darby':                  'The Holy Bible — Darby Translation (1890)',
  'bible_webster':                'The Holy Bible — Webster\u2019s Bible Translation (1833)',
  'bible_literal_translation':    'The Holy Bible — Literal Translation',
  // Cybersecurity (fill pass — NIST Special Publications)
  'nist_sp800-12_intro_infosec':  'NIST SP 800-12: Introduction to Information Security',
  'nist_sp800-30_risk_assessment': 'NIST SP 800-30: Guide for Conducting Risk Assessments',
  'nist_sp800-115_security_testing': 'NIST SP 800-115: Technical Guide to Security Testing',
  'nist_sp800-34_contingency_plan': 'NIST SP 800-34: Contingency Planning Guide',
  'nist_sp800-171_protecting_cui': 'NIST SP 800-171: Protecting Controlled Unclassified Information',
  'nist_sp800-39_managing_risk':  'NIST SP 800-39: Managing Information Security Risk',
  'nist_sp800-82_ot_security':    'NIST SP 800-82: Guide to Operational Technology Security',
  // Development (fill pass)
  'symbolic_logic_carroll':       'Symbolic Logic — Lewis Carroll (1896)',
  'system_of_logic_mill':         'A System of Logic — John Stuart Mill (1843)',
  'babbage_philosopher':          'Passages from the Life of a Philosopher — Babbage (1864)',
  'calculating_machines_1914':    'Calculating Machines (1914)',
  'foundations_of_science_poincare': 'The Foundations of Science — Poincaré',
  'practical_electricity_1917':   'Practical Electricity (1917)',
  'euclids_elements':             'Euclid\u2019s Elements — Foundational Mathematics',
  // Philosophy & Ethics
  'critique_of_pure_reason':      'Critique of Pure Reason — Immanuel Kant (1781)',
  'nicomachean_ethics':           'Nicomachean Ethics — Aristotle',
  'essays_montaigne':             'Essays — Michel de Montaigne (1580)',
  'essay_human_understanding_v1': 'An Essay Concerning Human Understanding, Vol. 1 — Locke (1690)',
  'essay_human_understanding_v2': 'An Essay Concerning Human Understanding, Vol. 2 — Locke (1690)',
  'beyond_good_and_evil':         'Beyond Good and Evil — Nietzsche (1886)',
  'problems_of_philosophy':       'The Problems of Philosophy — Bertrand Russell (1912)',
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
      // List all objects with pagination (R2 returns max 1000 per page)
      let allObjects = [];
      let cursor = undefined;
      let truncated = true;
      while (truncated) {
        const listed = await env.BUCKET.list({ limit: 1000, cursor });
        allObjects = allObjects.concat(listed.objects);
        truncated = listed.truncated;
        cursor = listed.truncated ? listed.cursor : undefined;
      }
      const packs = {};

      for (const obj of allObjects) {
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
            // m.icon intentionally ignored — frontend uses SVG icon system (icons.js)
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
