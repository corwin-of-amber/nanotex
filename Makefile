TEXLIVE_GIT = git@github.com:TeX-Live/texlive-source.git
TEXLIVE_GIT_TAG = tags/texlive-2025.0

ENGINES = tex mf gftopk pdftex bibtex

WEB2C_DIR  = workdir/texlive-build/texk/web2c
KPSE_DIR   = workdir/texlive-build/texk/kpathsea
SCRIPT_DIR = workdir/texlive-sources/texk/texlive/linked_scripts/texlive

KPSE_PROGS = kpsewhich kpseaccess kpsestat kpsereadlink
SCRIPTS = mktexlsr

TLFETCH = $(NANOTEX) install
NANOTEX = ./scripts/nanotex
DIST = dist
TLDIST = tldist

ifeq ($(FETCH),no)
TLFETCH = \# (skipping fetch)
endif


engines: workdir/texlive-build
	( cd $(WEB2C_DIR) && npx wasi-kit make $(ENGINES) )
	@mkdir -p bin
	cp ${foreach e, $(ENGINES), $(WEB2C_DIR)/$e $(WEB2C_DIR)/$e.wasm} bin/
	cp ${foreach e, $(KPSE_PROGS), $(KPSE_DIR)/$e} bin/
	cp ${foreach e, $(SCRIPTS), $(SCRIPT_DIR)/$e} bin/

# to build without WASM
engines-native: workdir/texlive-build
	( cd $(WEB2C_DIR) && make $(ENGINES) )
	@mkdir -p bin
	cp ${foreach e, $(ENGINES), $(WEB2C_DIR)/$e} bin/
	cp ${foreach e, $(KPSE_PROGS), $(KPSE_DIR)/$e} bin/
	cp ${foreach e, $(SCRIPTS), $(SCRIPT_DIR)/$e} bin/

clean-engines:
	( cd $(WEB2C_DIR) && make clean )

workdir/texlive-sources:
	mkdir -p workdir
	git clone -b $(TEXLIVE_GIT_TAG) --depth=1 $(TEXLIVE_GIT) $@

workdir/texlive-build: workdir/texlive-sources
	mkdir -p $@
	( cd $@ && ../texlive-sources/configure \
		--without-x --disable-shared --disable-all-pkgs \
        --enable-tex --disable-synctex --disable-arm-neon )
	( cd $@ && make )

boot: fetch-boot
	# reduces dependencies by restricting to US-en
	cp ${foreach e, us.def def, $(TLDIST)/tex/generic/config/language.$e}
	# build formats
	mkdir -p dist
	cd dist && ../bin/tex -jobname tex -ini tex.ini
	cd dist && ../bin/pdftex -jobname pdftex -ini -etex pdfetex.ini

fetch-boot:
	[ -e node_modules ] || npm install --no-audit
	$(TLFETCH) plain hyphen-base cm knuth-lib tex-ini-files pdftex etex
	$(NANOTEX) font --map pdftex

latex: fetch-latex
	cd bin && ln -sf pdftex pdflatex
	cd dist && ../bin/pdflatex -interaction=nonstopmode -ini -etex pdflatex.ini

fetch-latex:
	$(TLFETCH) latex latexconfig l3kernel l3backend latex-fonts unicode-data


fonts:
	# needed for Type 1 fonts
	$(TLFETCH) amsfonts

metafont: fetch-metafont
	./bin/mf -ini '\input plain; input modes; dump'
	mkdir -p $(DIST)/base
	mv plain.base $(DIST)/base/mf.base

fetch-metafont:
	$(TLFETCH) metafont modes

cm: fetch-cm
	$(NANOTEX) font --pk cmmi9  # the remaining bitmap fonts seem to be included in `cm` already?
	$(NANOTEX) font --map cm

fetch-cm:
	$(TLFETCH) cm

ec: fetch-ec
	# This package does not include a font map?
	$(NANOTEX) font --pk \
	    ${addprefix ecrm, 0500 0600 0700 0900 1000 1200 1440 1728} \
		${addprefix ecbx, 0900 1000 1200 1440} \
		${addprefix ecss, 1000 1200} \
		${addprefix ecti, 0900 1000} \
		${addprefix ectt, 0900 1000}

fetch-ec:
	$(TLFETCH) ec

lm: fetch-lm
	$(NANOTEX) font --map lm

fetch-lm:
	$(TLFETCH) lm

extra/pkgs: FORCE
	@mkdir -p $@
	tar cf extra/pkgs/some-fonts.tar -C dist fonts/compiled
	tar cf extra/pkgs/ls-R.tar -C tldist ls-R

# -- Distribution tarballs --

clean-slate:
	rm -rf workdir bin tlarchive tldist dist

clean-distro:
	rm -rf tlarchive tldist dist

# -- Distribution tarballs --

.PHONY: dist FORCE

FORCE:

dist: dist.tar tldist.tar

dist.tar: FORCE
	@rm -f dist.tar
	tar cf dist.tar --strip-components=1 dist

tldist.tar: FORCE
	@rm -rf tldist.tar
	tar cf tldist.tar --strip-components=1 tldist	
