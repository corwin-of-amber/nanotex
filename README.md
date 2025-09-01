# nanoTeX - Minimal LaTeX Build of TeXLive

## Build stages

1. Build the engines (TeX binaries)
   ```
   make engines
   ```

2. Bootstrap the TeX environment (format files and base fonts)
    ```
    make boot fonts
    ```
    to test it:
    ```
    ./scripts/unit.js qa/unit-test/00-most-basic/00-bare-minimum.tex
    ```
    (This script compiles a TeX file and writes output in `tmp/`.)

3. Bootstrap a LaTeX environment (links `pdflatex` -> `pdftex` and builds format files)
    ```
    make latex
    ```
    to test it:
    ```
    ./scripts/unit.js qa/unit-test/00-most-basic/01-bare-minimum.ltx
    ```

4. Set up MetaFont (needed if you want to build fonts)
    ```
    make metafont
    ```
    to test it:
    ```
    ./lib/nanotex.js font --pk cmtt10
    ./scripts/unit.js qa/unit-test/00-most-basic/02-base-fonts.tex
    ```
