# Wlasna biblioteka MP3

1. Skopiuj plik MP3 do tego folderu `music/`.
2. Otworz `music/library.js` i dodaj wpis do tablicy:

```js
{ title: "Tytul piosenki", artist: "Wykonawca", src: "music/piosenka.mp3" },
```

Miniaturke mozesz dodac przez wlasciwosc `artwork`. Czas jest automatycznie czytany z MP3; opcjonalna wlasciwosc `duration` podaje czas w sekundach:

```js
{ title: "Tytul", artist: "Wykonawca", src: "music/piosenka.mp3", artwork: "music/okladka.jpg", duration: 214 },
```

3. Zapisz plik i odswiez strone.

Nazwe w `src` wpisz dokladnie tak, jak nazywa sie plik. Sciezka jest liczona od glownego folderu strony. Mozesz tez dodac MP3 i opcjonalna miniaturke przyciskiem „Dodaj utwor”; takie pliki sa trwale zapisywane w bazie danych tej przegladarki.
