# VoxDown Composer instrument samples

These samples are served from this site only. Composer loads an instrument's files when it is
first chosen and keeps them in the browser's cache for offline use. They were prepared with
`scripts/prepare-composer-sounds.mjs`: every third semitone was kept, then each file was trimmed,
faded where the instrument decays, mixed to mono and encoded as 64 kbit/s MP3.

## Piano — `piano/`

Salamander Grand Piano V3, by Alexander Holm, recorded from a Yamaha C5.
Licence: Creative Commons Attribution 3.0 (https://creativecommons.org/licenses/by/3.0/).
Source of these renderings: https://tonejs.github.io/audio/salamander/ (Tone.js).
Original: https://archive.org/details/SalamanderGrandPianoV3

## Fiddle, flute, strings and nylon guitar — `fiddle/`, `flute/`, `strings/`, `guitar/`

From the Fluid (R3) General MIDI SoundFont (FluidR3_GM), by Frank Wen and contributors.
Licence: Creative Commons Attribution 3.0 (https://creativecommons.org/licenses/by/3.0/), as
published with the rendered notes at https://github.com/gleitz/midi-js-soundfonts.
Instruments used: `violin`, `flute`, `string_ensemble_1`, `acoustic_guitar_nylon`.

## Changes

Trimmed in length, faded out (piano and guitar), converted to mono and re-encoded. No other
changes. The file names are MIDI note numbers (60 is middle C).
