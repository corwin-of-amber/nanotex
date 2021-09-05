# Engine

 * From https://www.tug.org/texlive/doc/tlbuild.html#Build-one-engine
```
rsync -a --delete --exclude=.svn --exclude=Work \
      tug.org::tldevsrc/Build/source/ .

mkdir Work && cd Work
../configure --without-x --disable-shared --disable-all-pkgs \
             --enable-tex --disable-synctex
make           # will run `configure` in (many) subdirs
cd texk/web2c  # cd engine build directory
make tex       # must specify target
```
 * for pdftex: need to patch `libpng/config.h` for arm64
```
#define PNG_ARM_NEON_OPT 0
```
(may need to re-run make in libpng?)
(can use `--disable-arm-neon` in `configure`?)

```
make pdftex
```

# Format files

See also: `tl_support/fmtunil.cnf` (TeX Live's fmtutil)

Sources can be obtained from tlnet.
 * [plain] https://ftp.cc.uoc.gr/mirrors/CTAN/systems/texlive/tlnet/archive/plain.tar.xz
 * [hyphen-base] https://ftp.cc.uoc.gr/mirrors/CTAN/systems/texlive/tlnet/archive/hyphen-base.tar.xz
 * [tex-ini-files] https://ftp.cc.uoc.gr/mirrors/CTAN/systems/texlive/tlnet/archive/tex-ini-files.tar.xz

## tex.fmt

Need: tex.ini plain.tex hyphen.tex
```
tex -ini tex.ini
```

## pdftex.fmt

Need: pdfetex.ini pdftexmagfix.tex etex.src pdftexconfig.tex plain.tex hypen.tex
```
pdftex -ini -etex pdfetex.ini
mv pdfetex.fmt pdftex.fmt
```

Fonts: pdftex needs `.pfb` files. E.g. create `pdftex.map` containing:
```
cmr10 CMR10 <cmr10.pfb
```
And copy `cmr10.pfb` from
 * [amsfonts] https://ftp.cc.uoc.gr/mirrors/CTAN/systems/texlive/tlnet/archive/amsfonts.tar.xz

(Repeat for other needed fonts, esp. `cmr7` and `cmmi10`.)

## pdflatex.fmt

Need: pdflatex.ini
latex.ltx texsys.cfg fonttext.ltx fonttext.ltx omlenc.def omsenc.def ot1enc.def t1enc.def ts1enc.def
t1cmr.fd ot1cmr.fd ot1cmss.fd ot1cmtt.fd fontmath.ltx omlcmm.fd omscmsy.fd omxcmex.fd ucmr.fd ts1cmr.fd
preload.ltx hyphen.ltx utf8.def ltexpl.ltx

For Unicode support: omsenc.dfu ot1enc.dfu t1enc.dfu ts1enc.dfu

(See tlnet package `latex`.)

```
ln -s pdftex pdflatex
pdflatex -ini -etex pdflatex.ini
```
