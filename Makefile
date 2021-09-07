
TLFETCH = ./scripts/tlfetch
DIST = dist
TLDIST = tldist

ifeq ($(FETCH),no)
TLFETCH = \# (skipping fetch)
endif


boot: fetch-boot
	# reduces dependencies by restricting to US-en
	cp ${foreach e, us.def def, $(TLDIST)/tex/generic/config/language.$e}
	# build formats
	mkdir -p dist
	cd dist && ../bin/tex -ini tex.ini
	cd dist && ../bin/pdftex -ini -etex pdfetex.ini

fetch-boot:
	$(TLFETCH) plain hyphen-base cm knuth-lib tex-ini-files pdftex etex

latex: fetch-latex
	touch dist/UnicodeData.txt  # skip pkg `unicode-data`
	cd dist && ../bin/pdflatex -ini -etex pdflatex.ini

fetch-latex:
	$(TLFETCH) latex latexconfig l3kernel latex-fonts


metafont: metafont-fetch
	./bin/mf -ini '\input plain; input modes; dump'
	mkdir -p $(DIST)/base
	mv plain.base $(DIST)/base/mf.base

metafont-fetch:
	$(TLFETCH) metafont modes

ec: ec-fetch
	./scripts/nanotex font \
	    ${addprefix ecrm, 0500 0600 0700 0900 1000 1200 1440 1728} \
		${addprefix ecbx, 0900 1000 1200 1440} \
		${addprefix ecss, 1000 1200} \
		${addprefix ecti, 0900 1000} \
		${addprefix ectt, 0900 1000}

ec-fetch:
	$(TLFETCH) ec

# -- Distribution tarballs --

.PHONY: dist FORCE

FORCE:

dist: dist.tar tldist.tar

dist.tar: FORCE
	@rm -f dist.tar
	tar cf dist.tar --strip-components=1 dist

tldist.tar: FORCE
	@rm -rf tldist.tar
	tar cf tldist.tar --exclude archive --strip-components=1 tldist	
