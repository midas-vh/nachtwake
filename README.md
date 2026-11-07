# NACHTWAKE

First-person horror in de Notre-Dame, in de browser.

**Spelen:** https://midas-vh.github.io/nachtwake/

Notre-Dame, 03:12. Het onweer slaat de stroom uit en achter je vallen de deuren in het slot.
Vind de vijf relikwieën in het donker, dan gaat het westportaal weer open. Je bent niet alleen.

## Besturing
- **W A S D**: lopen, **Shift**: rennen (maakt lawaai)
- **Muis**: rondkijken (klik in het spel om de muis vast te zetten; lukt dat niet, sleep dan met ingedrukte muisknop)
- **F**: zaklamp aan/uit, **E**: oppakken, **Esc**: pauze

Houd de lichtbundel op het wezen om het te verjagen. Dat kost wel batterij.

Gebruik een koptelefoon. Bevat harde geluiden, schrikmomenten en flitsend licht.
Loopt het schokkerig? Open dan de lichte versie: https://midas-vh.github.io/nachtwake/?low

## Techniek
Three.js, three-mesh-bvh voor botsingen, en alle geluid live gemaakt met de Web Audio API.
De kathedraal is in Blender opgebouwd met een Python-script en als GLB geëxporteerd.
Lokaal draaien: `start-server.bat` (poort 8094).
