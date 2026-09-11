# Orbmark

**Lascia il tuo segno sul mondo 🌍**

## Versione

**V1.3.9**

## Fix regressione V1.3.8

La V1.3.8 applicava il blocco tastiera/viewport in modo troppo globale e poteva
interferire con il passaggio Regione → sotto-zone.

Questa versione parte dalla V1.3.7 stabile e applica il blocco tastiera soltanto
alla finestra **Cerca nel mondo**:

- nessun blocco globale dei dialog
- nessun `position: fixed` sul body
- nessuna interferenza con Leaflet o caricamento ADM2
- ricerca ferma durante la digitazione
- risultati scorrono solo dentro il popup
- input ricerca a 16px per evitare auto-zoom iOS

## Copyright

© 2026 Orbmark. Tutti i diritti riservati.
