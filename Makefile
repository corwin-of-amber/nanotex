
TLFETCH = ./scripts/tlfetch
DIST = dist
TLDIST = tldist


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


metafont:
	./bin/mf -ini '\input plain; input modes; dump'
	mkdir -p $(DIST)/base
	mv plain.base $(DIST)/base/mf.base

metafont-fetch:
	./tlfetch metafont modes

ec:
	./scripts/nanotex font \
	    ${addprefix ecrm, 0500 0600 0700 0900 1000 1200 1440 1728} \
		${addprefix ecbx, 0900 1000 1200 1440} \
		${addprefix ecss, 1000 1200} \
		${addprefix ecti, 0900 1000} \
		${addprefix ectt, 0900 1000}
