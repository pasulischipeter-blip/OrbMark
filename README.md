# Orbmark

**Lascia il tuo segno sul mondo 🌍**

## Versione

**V1.3.6**

## Correzione auto-update

La V1.3.5 conteneva ancora internamente `BUILD_VERSION = 1.3.4`, mentre `version.json`
indicava una versione più recente. Per questo Orbmark poteva interpretare ogni avvio
come un nuovo aggiornamento e ricaricarsi continuamente.

Questa versione:
- allinea `BUILD_VERSION` a **1.3.6**
- blocca reload ripetuti della stessa versione nella stessa sessione
- inizializza la web app solo se non è già in corso un reload di aggiornamento
- continua a non toccare i dati salvati in `localStorage`

## Copyright

© 2026 Orbmark. Tutti i diritti riservati.
