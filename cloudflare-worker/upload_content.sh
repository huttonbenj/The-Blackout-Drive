#!/bin/bash
# R2 Upload Script — The Blackout Drive Content
# Run from: /Users/benjamin/github/The-Blackout-Drive/cloudflare-worker/

NPX="/opt/homebrew/opt/node@24/bin/npx"
BUCKET="blackout-drive-content"
B="/Users/benjamin/github/The-Blackout-Drive/drive/_system/content/books"

PASS=0; FAIL=0
up() {
  echo -n "  $1 ... "
  "$NPX" wrangler r2 object put "$BUCKET/$1" --file="$2" --content-type="${3:-application/epub+zip}" --remote 2>&1 | tail -1
  [ ${PIPESTATUS[0]} -eq 0 ] && { echo "✅"; ((PASS++)); } || { echo "❌"; ((FAIL++)); }
}

echo "── SURVIVAL ──"
"$NPX" wrangler r2 object put "$BUCKET/survival/army_fm21-76_survival_1992.pdf" --file="$B/survival/army_fm21-76_survival_1992.pdf" --content-type="application/pdf" --remote && echo "  ✅ army_fm21-76" && ((PASS++)) || { echo "  ❌ army_fm21-76"; ((FAIL++)); }
"$NPX" wrangler r2 object put "$BUCKET/survival/woodcraft_camping.epub"          --file="$B/survival/woodcraft_camping.epub"          --content-type="application/epub+zip" --remote && echo "  ✅ woodcraft_camping" && ((PASS++)) || { echo "  ❌"; ((FAIL++)); }
"$NPX" wrangler r2 object put "$BUCKET/survival/camp_lore_woodcraft.epub"        --file="$B/survival/camp_lore_woodcraft.epub"        --content-type="application/epub+zip" --remote && echo "  ✅ camp_lore" && ((PASS++)) || { echo "  ❌"; ((FAIL++)); }
"$NPX" wrangler r2 object put "$BUCKET/survival/how_to_camp_out.epub"            --file="$B/survival/how_to_camp_out.epub"            --content-type="application/epub+zip" --remote && echo "  ✅ how_to_camp_out" && ((PASS++)) || { echo "  ❌"; ((FAIL++)); }
"$NPX" wrangler r2 object put "$BUCKET/survival/knots_and_splices.epub"          --file="$B/survival/knots_and_splices.epub"          --content-type="application/epub+zip" --remote && echo "  ✅ knots" && ((PASS++)) || { echo "  ❌"; ((FAIL++)); }
echo '{"name":"Survival & Field Craft","description":"US Army field manuals, bushcraft guides, wilderness survival classics.","icon":"🛡","price":0}' | "$NPX" wrangler r2 object put "$BUCKET/survival/_meta.json" --pipe --content-type="application/json" --remote && echo "  ✅ survival/_meta.json" || echo "  ❌"

echo "── MEDICAL ──"
"$NPX" wrangler r2 object put "$BUCKET/medical/merck_materia_medica.epub"        --file="$B/medical/merck_materia_medica.epub"        --content-type="application/epub+zip" --remote && echo "  ✅ merck" && ((PASS++)) || { echo "  ❌"; ((FAIL++)); }
"$NPX" wrangler r2 object put "$BUCKET/medical/home_medical_library.epub"        --file="$B/medical/home_medical_library.epub"        --content-type="application/epub+zip" --remote && echo "  ✅ home_medical" && ((PASS++)) || { echo "  ❌"; ((FAIL++)); }
"$NPX" wrangler r2 object put "$BUCKET/medical/household_medicine.epub"          --file="$B/medical/household_medicine.epub"          --content-type="application/epub+zip" --remote && echo "  ✅ household_medicine" && ((PASS++)) || { echo "  ❌"; ((FAIL++)); }
"$NPX" wrangler r2 object put "$BUCKET/medical/manual_surgery_operations.epub"   --file="$B/medical/manual_surgery_operations.epub"   --content-type="application/epub+zip" --remote && echo "  ✅ surgery" && ((PASS++)) || { echo "  ❌"; ((FAIL++)); }
echo '{"name":"Medical & First Aid","description":"Field medicine, drug references, herbal remedies.","icon":"💊","price":0}' | "$NPX" wrangler r2 object put "$BUCKET/medical/_meta.json" --pipe --content-type="application/json" --remote && echo "  ✅ medical/_meta.json" || echo "  ❌"

echo "── HOMESTEAD ──"
"$NPX" wrangler r2 object put "$BUCKET/homestead/culpeper_herbal.epub"           --file="$B/homestead/culpeper_herbal.epub"           --content-type="application/epub+zip" --remote && echo "  ✅ culpeper" && ((PASS++)) || { echo "  ❌"; ((FAIL++)); }
"$NPX" wrangler r2 object put "$BUCKET/homestead/ten_acres_enough.epub"          --file="$B/homestead/ten_acres_enough.epub"          --content-type="application/epub+zip" --remote && echo "  ✅ ten_acres" && ((PASS++)) || { echo "  ❌"; ((FAIL++)); }
"$NPX" wrangler r2 object put "$BUCKET/homestead/manual_of_gardening.epub"       --file="$B/homestead/manual_of_gardening.epub"       --content-type="application/epub+zip" --remote && echo "  ✅ gardening" && ((PASS++)) || { echo "  ❌"; ((FAIL++)); }
"$NPX" wrangler r2 object put "$BUCKET/homestead/home_vegetable_gardening.epub"  --file="$B/homestead/home_vegetable_gardening.epub"  --content-type="application/epub+zip" --remote && echo "  ✅ veg_garden" && ((PASS++)) || { echo "  ❌"; ((FAIL++)); }
"$NPX" wrangler r2 object put "$BUCKET/homestead/langstroth_beekeeping.epub"     --file="$B/homestead/langstroth_beekeeping.epub"     --content-type="application/epub+zip" --remote && echo "  ✅ beekeeping" && ((PASS++)) || { echo "  ❌"; ((FAIL++)); }
"$NPX" wrangler r2 object put "$BUCKET/homestead/soil_nature_uses.epub"          --file="$B/homestead/soil_nature_uses.epub"          --content-type="application/epub+zip" --remote && echo "  ✅ soil" && ((PASS++)) || { echo "  ❌"; ((FAIL++)); }
echo '{"name":"Homestead & Self-Reliance","description":"Off-grid farming, herbalism, beekeeping, and small-farm self-sufficiency.","icon":"🌿","price":0}' | "$NPX" wrangler r2 object put "$BUCKET/homestead/_meta.json" --pipe --content-type="application/json" --remote && echo "  ✅ homestead/_meta.json" || echo "  ❌"

echo "── LAW ──"
"$NPX" wrangler r2 object put "$BUCKET/law/blacks_law_dictionary_1910.epub"      --file="$B/law/blacks_law_dictionary_1910.epub"  --content-type="application/epub+zip" --remote && echo "  ✅ blacks_law" && ((PASS++)) || { echo "  ❌"; ((FAIL++)); }
"$NPX" wrangler r2 object put "$BUCKET/law/declaration_of_independence.epub"     --file="$B/law/declaration_of_independence.epub" --content-type="application/epub+zip" --remote && echo "  ✅ declaration" && ((PASS++)) || { echo "  ❌"; ((FAIL++)); }
"$NPX" wrangler r2 object put "$BUCKET/law/magna_carta.epub"                     --file="$B/law/magna_carta.epub"                 --content-type="application/epub+zip" --remote && echo "  ✅ magna_carta" && ((PASS++)) || { echo "  ❌"; ((FAIL++)); }
"$NPX" wrangler r2 object put "$BUCKET/law/us_constitution.epub"                 --file="$B/law/us_constitution.epub"             --content-type="application/epub+zip" --remote && echo "  ✅ constitution" && ((PASS++)) || { echo "  ❌"; ((FAIL++)); }
"$NPX" wrangler r2 object put "$BUCKET/law/federalist_papers.epub"               --file="$B/law/federalist_papers.epub"           --content-type="application/epub+zip" --remote && echo "  ✅ federalist" && ((PASS++)) || { echo "  ❌"; ((FAIL++)); }
"$NPX" wrangler r2 object put "$BUCKET/law/common_sense_paine.epub"              --file="$B/law/common_sense_paine.epub"          --content-type="application/epub+zip" --remote && echo "  ✅ common_sense" && ((PASS++)) || { echo "  ❌"; ((FAIL++)); }
echo '{"name":"Law & Rights","description":"US Constitution, Declaration of Independence, Magna Carta, Federalist Papers.","icon":"⚖️","price":0}' | "$NPX" wrangler r2 object put "$BUCKET/law/_meta.json" --pipe --content-type="application/json" --remote && echo "  ✅ law/_meta.json" || echo "  ❌"

echo "── PHILOSOPHY ──"
"$NPX" wrangler r2 object put "$BUCKET/philosophy/meditations_marcus_aurelius.epub" --file="$B/philosophy/meditations_marcus_aurelius.epub" --content-type="application/epub+zip" --remote && echo "  ✅ meditations" && ((PASS++)) || { echo "  ❌"; ((FAIL++)); }
"$NPX" wrangler r2 object put "$BUCKET/philosophy/art_of_war.epub"                  --file="$B/philosophy/art_of_war.epub"                  --content-type="application/epub+zip" --remote && echo "  ✅ art_of_war" && ((PASS++)) || { echo "  ❌"; ((FAIL++)); }
"$NPX" wrangler r2 object put "$BUCKET/philosophy/plato_republic.epub"              --file="$B/philosophy/plato_republic.epub"              --content-type="application/epub+zip" --remote && echo "  ✅ plato" && ((PASS++)) || { echo "  ❌"; ((FAIL++)); }
"$NPX" wrangler r2 object put "$BUCKET/philosophy/enchiridion_epictetus.epub"       --file="$B/philosophy/enchiridion_epictetus.epub"       --content-type="application/epub+zip" --remote && echo "  ✅ epictetus" && ((PASS++)) || { echo "  ❌"; ((FAIL++)); }
"$NPX" wrangler r2 object put "$BUCKET/philosophy/seneca_moral_letters.epub"        --file="$B/philosophy/seneca_moral_letters.epub"        --content-type="application/epub+zip" --remote && echo "  ✅ seneca" && ((PASS++)) || { echo "  ❌"; ((FAIL++)); }
"$NPX" wrangler r2 object put "$BUCKET/philosophy/walden_thoreau.epub"              --file="$B/philosophy/walden_thoreau.epub"              --content-type="application/epub+zip" --remote && echo "  ✅ walden" && ((PASS++)) || { echo "  ❌"; ((FAIL++)); }
echo '{"name":"Philosophy & Wisdom","description":"Marcus Aurelius, Epictetus, Sun Tzu, Plato, Seneca, and Thoreau.","icon":"∞","price":0}' | "$NPX" wrangler r2 object put "$BUCKET/philosophy/_meta.json" --pipe --content-type="application/json" --remote && echo "  ✅ philosophy/_meta.json" || echo "  ❌"

echo "── BIBLE ──"
"$NPX" wrangler r2 object put "$BUCKET/bible/bible_kjv.txt" --file="$B/bible/bible_kjv.txt" --content-type="text/plain" --remote && echo "  ✅ kjv" && ((PASS++)) || { echo "  ❌"; ((FAIL++)); }
"$NPX" wrangler r2 object put "$BUCKET/bible/bible_web.txt" --file="$B/bible/bible_web.txt" --content-type="text/plain" --remote && echo "  ✅ web" && ((PASS++)) || { echo "  ❌"; ((FAIL++)); }
"$NPX" wrangler r2 object put "$BUCKET/bible/bible_asv.txt" --file="$B/bible/bible_asv.txt" --content-type="text/plain" --remote && echo "  ✅ asv" && ((PASS++)) || { echo "  ❌"; ((FAIL++)); }
"$NPX" wrangler r2 object put "$BUCKET/bible/bible_ylt.txt" --file="$B/bible/bible_ylt.txt" --content-type="text/plain" --remote && echo "  ✅ ylt" && ((PASS++)) || { echo "  ❌"; ((FAIL++)); }
echo '{"name":"The Holy Bible","description":"KJV, World English Bible, ASV, and Young'\''s Literal Translation.","icon":"✝️","price":0}' | "$NPX" wrangler r2 object put "$BUCKET/bible/_meta.json" --pipe --content-type="application/json" --remote && echo "  ✅ bible/_meta.json" || echo "  ❌"

echo "── CLASSICS ──"
"$NPX" wrangler r2 object put "$BUCKET/classics/art-of-war.epub"       --file="$B/classics/art-of-war.epub"       --content-type="application/epub+zip" --remote && echo "  ✅ art-of-war" && ((PASS++)) || { echo "  ❌"; ((FAIL++)); }
"$NPX" wrangler r2 object put "$BUCKET/classics/common-sense.epub"     --file="$B/classics/common-sense.epub"     --content-type="application/epub+zip" --remote && echo "  ✅ common-sense" && ((PASS++)) || { echo "  ❌"; ((FAIL++)); }
"$NPX" wrangler r2 object put "$BUCKET/classics/enchiridion.epub"      --file="$B/classics/enchiridion.epub"      --content-type="application/epub+zip" --remote && echo "  ✅ enchiridion" && ((PASS++)) || { echo "  ❌"; ((FAIL++)); }
"$NPX" wrangler r2 object put "$BUCKET/classics/meditations.epub"      --file="$B/classics/meditations.epub"      --content-type="application/epub+zip" --remote && echo "  ✅ meditations" && ((PASS++)) || { echo "  ❌"; ((FAIL++)); }
"$NPX" wrangler r2 object put "$BUCKET/classics/the-republic.epub"     --file="$B/classics/the-republic.epub"     --content-type="application/epub+zip" --remote && echo "  ✅ the-republic" && ((PASS++)) || { echo "  ❌"; ((FAIL++)); }
"$NPX" wrangler r2 object put "$BUCKET/classics/us-constitution.epub"  --file="$B/classics/us-constitution.epub"  --content-type="application/epub+zip" --remote && echo "  ✅ us-constitution" && ((PASS++)) || { echo "  ❌"; ((FAIL++)); }
echo '{"name":"Classic Literature","description":"Timeless works on strategy, governance, philosophy, and the human condition.","icon":"📖","price":0}' | "$NPX" wrangler r2 object put "$BUCKET/classics/_meta.json" --pipe --content-type="application/json" --remote && echo "  ✅ classics/_meta.json" || echo "  ❌"

echo "── PREPAREDNESS ──"
"$NPX" wrangler r2 object put "$BUCKET/preparedness/fema_are_you_ready.pdf" --file="$B/preparedness/fema_are_you_ready.pdf" --content-type="application/pdf" --remote && echo "  ✅ fema" && ((PASS++)) || { echo "  ❌"; ((FAIL++)); }
echo '{"name":"Emergency Preparedness","description":"Government disaster readiness guides and emergency planning resources.","icon":"📋","price":0}' | "$NPX" wrangler r2 object put "$BUCKET/preparedness/_meta.json" --pipe --content-type="application/json" --remote && echo "  ✅ preparedness/_meta.json" || echo "  ❌"

echo "── TECHNOLOGY ──"
"$NPX" wrangler r2 object put "$BUCKET/technology/practical_mechanics.epub" --file="$B/technology/practical_mechanics.epub" --content-type="application/epub+zip" --remote && echo "  ✅ practical_mechanics" && ((PASS++)) || { echo "  ❌"; ((FAIL++)); }
"$NPX" wrangler r2 object put "$BUCKET/technology/machine_shop_practice.epub" --file="$B/technology/machine_shop_practice.epub" --content-type="application/epub+zip" --remote && echo "  ✅ machine_shop_practice" && ((PASS++)) || { echo "  ❌"; ((FAIL++)); }
echo '{"name":"Technology & Engineering","description":"Practical mechanics, machine-shop techniques, and hands-on engineering.","icon":"⚙️","price":0}' | "$NPX" wrangler r2 object put "$BUCKET/technology/_meta.json" --pipe --content-type="application/json" --remote && echo "  ✅ technology/_meta.json" || echo "  ❌"

echo "── CYBERSECURITY ──"
"$NPX" wrangler r2 object put "$BUCKET/cybersecurity/nist_sp800-53_rev5.pdf" --file="$B/cybersecurity/nist_sp800-53_rev5.pdf" --content-type="application/pdf" --remote && echo "  ✅ nist_sp800-53" && ((PASS++)) || { echo "  ❌"; ((FAIL++)); }
"$NPX" wrangler r2 object put "$BUCKET/cybersecurity/nist_cybersecurity_framework_2.pdf" --file="$B/cybersecurity/nist_cybersecurity_framework_2.pdf" --content-type="application/pdf" --remote && echo "  ✅ csf_2.0" && ((PASS++)) || { echo "  ❌"; ((FAIL++)); }
"$NPX" wrangler r2 object put "$BUCKET/cybersecurity/nist_sp800-61_incident_handling.pdf" --file="$B/cybersecurity/nist_sp800-61_incident_handling.pdf" --content-type="application/pdf" --remote && echo "  ✅ incident_handling" && ((PASS++)) || { echo "  ❌"; ((FAIL++)); }
echo '{"name":"Systems & Cybersecurity","description":"NIST security frameworks, access controls, and incident response guides.","icon":"🔒","price":0}' | "$NPX" wrangler r2 object put "$BUCKET/cybersecurity/_meta.json" --pipe --content-type="application/json" --remote && echo "  ✅ cybersecurity/_meta.json" || echo "  ❌"

echo "── DEVELOPMENT ──"
"$NPX" wrangler r2 object put "$BUCKET/development/pro_git.epub" --file="$B/development/pro_git.epub" --content-type="application/epub+zip" --remote && echo "  ✅ pro_git" && ((PASS++)) || { echo "  ❌"; ((FAIL++)); }
"$NPX" wrangler r2 object put "$BUCKET/development/think_python.pdf" --file="$B/development/think_python.pdf" --content-type="application/pdf" --remote && echo "  ✅ think_python" && ((PASS++)) || { echo "  ❌"; ((FAIL++)); }
"$NPX" wrangler r2 object put "$BUCKET/development/linux_command_line.pdf" --file="$B/development/linux_command_line.pdf" --content-type="application/pdf" --remote && echo "  ✅ linux_command_line" && ((PASS++)) || { echo "  ❌"; ((FAIL++)); }
echo '{"name":"Software & Development","description":"Version control, Python programming, and Linux command-line mastery.","icon":"💻","price":0}' | "$NPX" wrangler r2 object put "$BUCKET/development/_meta.json" --pipe --content-type="application/json" --remote && echo "  ✅ development/_meta.json" || echo "  ❌"

echo ""
echo "=== Done: $PASS uploaded, $FAIL failed ==="
