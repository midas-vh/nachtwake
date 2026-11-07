# Nachtwake

First-person horrorgame in de Notre-Dame (Three.js r160 via importmap, geen build-stap).

## Starten
- `start-server.bat` (poort 8094), of preview "nachtwake" in de root-`.claude/launch.json`.
- `?low`: geen spiegelvloer en schaduwen (voor zwakkere pc's).
- `?debug`: start zonder pointer lock, fps in de titel, `window.G` met hulpjes (`G.tp(x, y)` in
  Blender-coördinaten, `G.setView(yaw, pitch)`, `G.trigger('crash'|'behind'|'unlock')`), toetsen 1-4 starten events.
  `?debug&god`: het wezen kan je niet pakken.

## Opbouw
- `assets/kathedraal.glb`: geëxporteerd uit `blender/projecten/notre_dame/` met
  `notre_dame_export_glb.py`. Exporteer opnieuw als het bouwscript verandert.
- `js/main.js`: laden, botsing (three-mesh-bvh capsule), speler, licht/bliksem, AI van het wezen, events.
- `js/world.js`: triplanaire materialen (de GLB heeft geen UV's), natte spiegelvloer, post-effect.
- `js/audio.js`: alle geluid gesynthetiseerd met Web Audio (geen geluidsbestanden).
- `js/entity.js`, `js/textures.js`: het wezen en procedurele textures.

## Afspraken
- Coördinaten in de code staan in Blender-assen via `B(x, y, z)`: X dwars, Y naar het koor, Z omhoog.
- Afstanden tot de speler horizontaal meten (`hdist`): `P.pos` ligt 1,45 m boven de vloer.
- Materialen van het wezen mat houden (Lambert): de zaklamp zit naast de camera en maakt anders alles glanzend grijs.
