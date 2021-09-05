
TLFETCH = ./scripts/tlfetch


boot: fetch-boot
	mkdir -p dist
	cd dist && ../bin/tex -ini tex.ini

fetch-boot:
	$(TLFETCH) plain hyphen-base cm knuth-lib
