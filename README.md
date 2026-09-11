# Orbmark

**Lascia il tuo segno sul mondo 🌍**

## Versione

**V1.3.4**

## Aggiornamento automatico

Da questa versione Orbmark controlla `version.json` a ogni avvio/refresh.

Se trova una versione più recente:
- svuota le Cache API
- disinstalla eventuali Service Worker vecchi
- ricarica l'URL con un parametro anti-cache
- forza così il caricamento dei file più recenti

### Importante
La prima installazione di questa V1.3.4 va caricata/aggiornata normalmente.
Da quel momento in poi le versioni successive potranno essere rilevate e forzate automaticamente.

## Dati

I dati visitati restano in `localStorage` e non vengono cancellati dal meccanismo di update.

## Copyright

© 2026 Orbmark. Tutti i diritti riservati.
