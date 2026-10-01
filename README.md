# Paroliamo

Wordle multiplayer per le serate in chiamata. Web app statica (HTML/CSS/JS, nessuna build).

- **Anagrammi a raffica**: lettere mescolate uguali per tutti, il primo che ricompone la parola prende 100 punti (aiutino a metà tempo).
- **Wordle** (🇮🇹 / 🇬🇧, 4–7 lettere): *Classica* (stessa parola per tutti), *Parola dell'amico* (a turno uno sceglie la parola), *Sprint* (più parole possibile a tempo). A sinistra si vedono i colori degli avversari, non le lettere.
- Punteggio cumulativo della serata, premi finali, reazioni emoji, allenamento in solitaria.

Multiplayer: Firebase Realtime Database via REST + SSE (stesso database di HitQuiz, stanze sotto `/rooms/pq-CODICE`). Il link d'invito porta con sé l'URL del database.

Sviluppo: `python3 tools/devserver.py` avvia file statici + finto Firebase su `http://localhost:8480/fb`.
Parole: `tools/build_words.py` (Morph-it + FrequencyWords) e `tools/build_words_en.py`, sorgenti in `data_src/` (non versionate).
