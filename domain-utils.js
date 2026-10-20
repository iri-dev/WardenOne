/* WardenOne — Copyright (C) 2026 iri
   Licensed under the GNU General Public License v3 or later. See LICENSE.
   Official source: https://github.com/iri-dev/WardenOne
   Upstream filter-list attribution: CREDITS.md
   Redistributing a modified copy? GPLv3 section 5(a) requires you to mark it as changed,
   with the date, and to keep these notices intact. */
/* Shared site boundaries in the worker, extension pages and both content-script worlds.
 * ICANN rules apply everywhere; the worker adds the full private list to the curated
 * tenant floor. Opaque cloud infrastructure keeps an exact-host identity. */

/* BEGIN GENERATED ICANN PSL — tools/build-psl.js
   Public Suffix List contributors, MPL-2.0: https://publicsuffix.org/list/public_suffix_list.dat
   Source version: 2026-09-17_19-09-53_UTC. Grouped by TLD; single-label rules use the default wildcard. */
const WARDENONE_ICANN_GROUPS = Object.freeze({
  "ac": "com|edu|gov|mil|net|org",
  "ae": "ac|co|gov|mil|net|org|sch",
  "aero": "accident-investigation|accident-prevention|aerobatic|aeroclub|aerodrome|agents|air-surveillance|air-traffic-control|aircraft|airline|airport|airtraffic|ambulance|association|author|ballooning|broker|caa|cargo|catering|certification|championship|charter|civilaviation|club|conference|consultant|consulting|control|council|crew|design|dgca|educator|emergency|engine|engineer|entertainment|equipment|exchange|express|federation|flight|freight|fuel|gliding|government|groundhandling|group|hanggliding|homebuilt|insurance|journal|journalist|leasing|logistics|magazine|maintenance|marketplace|media|microlight|modelling|navigation|parachuting|paragliding|passenger-association|pilot|press|production|recreation|repbody|res|research|rotorcraft|safety|scientist|services|show|skydiving|software|student|taxi|trader|trading|trainer|union|workinggroup|works",
  "af": "com|edu|gov|net|org",
  "ag": "co|com|net|nom|org",
  "ai": "com|net|off|org",
  "al": "com|edu|gov|mil|net|org",
  "am": "co|com|commune|net|org",
  "ao": "co|ed|edu|gov|gv|it|og|org|pb",
  "ar": "bet|com|coop|edu|gob|gov|int|mil|musica|mutual|net|org|seg|senasa|tur",
  "arpa": "e164|home|in-addr|ip6|iris|uri|urn",
  "as": "gov",
  "at": "ac|co|gv|or|sth.ac",
  "au": "act|act.edu|asn|catholic.edu|com|conf|edu|gov|id|net|nsw|nsw.edu|nt|nt.edu|org|oz|qld|qld.edu|qld.gov|sa|sa.edu|sa.gov|tas|tas.edu|tas.gov|vic|vic.edu|vic.gov|wa|wa.edu|wa.gov",
  "aw": "com",
  "az": "biz|co|com|edu|gov|info|int|mil|name|net|org|pp|pro",
  "ba": "com|edu|gov|mil|net|org",
  "bb": "biz|co|com|edu|gov|info|net|org|store|tv",
  "bd": "ac|ai|co|com|edu|gov|id|info|it|mil|net|org|sch|tv",
  "be": "ac",
  "bf": "gov",
  "bg": "0|1|2|3|4|5|6|7|8|9|a|b|c|d|e|f|g|h|i|j|k|l|m|n|o|p|q|r|s|t|u|v|w|x|y|z",
  "bh": "com|edu|gov|net|org",
  "bi": "co|com|edu|or|org",
  "bj": "africa|agro|architectes|assur|avocats|co|com|eco|econo|edu|info|loisirs|money|net|org|ote|restaurant|resto|tourism|univ",
  "bm": "com|edu|gov|net|org",
  "bn": "com|edu|gov|net|org",
  "bo": "academia|agro|arte|blog|bolivia|ciencia|com|cooperativa|democracia|deporte|ecologia|economia|edu|empresa|gob|ia|indigena|industria|info|int|medicina|mil|movimiento|musica|natural|net|nombre|noticias|org|patria|plurinacional|politica|profesional|pueblo|revista|salud|tecnologia|tksat|transporte|tv|web|wiki",
  "br": "*.nom|9guacu|abc|ac.gov|adm|adv|agr|aju|al.gov|am|am.gov|anani|ap.gov|aparecida|api|app|arq|art|ato|b|ba.gov|barueri|belem|bet|bhz|bib|bio|blog|bmd|boavista|bsb|campinagrande|campinas|caxias|ce.gov|cim|cng|cnt|com|contagem|coop|coz|cri|cuiaba|curitiba|def|des|det|dev|df.gov|ecn|eco|edu|emp|enf|eng|es.gov|esp|etc|eti|far|feira|flog|floripa|fm|fnd|fortal|fot|foz|fst|g12|geo|ggf|go.gov|goiania|gov|gru|ia|imb|ind|inf|jab|jampa|jdf|joinville|jor|jus|leg|leilao|lel|log|londrina|ma.gov|macapa|maceio|manaus|maringa|mat|med|mg.gov|mil|morena|mp|ms.gov|mt.gov|mus|natal|net|niteroi|not|ntr|odo|ong|org|osasco|pa.gov|palmas|pb.gov|pe.gov|pi.gov|poa|ppg|pr.gov|pro|psc|psi|pvh|qsl|radio|rec|recife|rep|ribeirao|rio|riobranco|riopreto|rj.gov|rn.gov|ro.gov|rr.gov|rs.gov|salvador|sampa|santamaria|santoandre|saobernardo|saogonca|sc.gov|se.gov|seg|sjc|slg|slz|social|sorocaba|sp.gov|srv|taxi|tc|tec|teo|the|tmp|to.gov|trd|tur|tv|udi|vet|vix|vlog|wiki|xyz|zlg",
  "bs": "com|edu|gov|net|org",
  "bt": "com|edu|gov|net|org",
  "bw": "ac|co|gov|net|org",
  "by": "com|gov|mil|of",
  "bz": "co|com|edu|gov|net|org",
  "ca": "ab|bc|gc|mb|nb|nf|nl|ns|nt|nu|on|pe|qc|sk|yk",
  "cd": "gov",
  "ci": "ac|asso|co|com|ed|edu|go|gouv|int|net|or|org|xn--aroport-bya",
  "ck": "!www|*",
  "cl": "co|gob|gov|mil",
  "cm": "co|com|gov|net",
  "cn": "ac|ah|bj|com|cq|edu|fj|gd|gov|gs|gx|gz|ha|hb|he|hi|hk|hl|hn|jl|js|jx|ln|mil|mo|net|nm|nx|org|qh|sc|sd|sh|sn|sx|tj|tw|xj|xn--55qx5d|xn--io0a7i|xn--od0alg|xz|yn|zj",
  "co": "com|edu|gov|mil|net|nom|org",
  "cr": "ac|co|ed|fi|go|or|sa",
  "cu": "com|edu|gob|inf|nat|net|org",
  "cv": "com|edu|id|int|net|nome|org|publ",
  "cw": "com|edu|net|org",
  "cx": "gov",
  "cy": "ac|biz|com|ekloges|gov|ltd|mil|net|org|press|pro|tm",
  "cz": "gov",
  "dm": "co|com|edu|gov|net|org",
  "do": "art|com|edu|gob|gov|mil|net|org|sld|web",
  "dz": "art|asso|com|edu|gov|net|org|pol|soc|tm",
  "ec": "abg|adm|agron|arqt|art|bar|chef|com|cont|cpa|cue|dent|dgn|disco|doc|edu|eng|esm|fin|fot|gal|gob|gov|gye|ibr|info|k12|lat|loj|med|mil|mktg|mon|net|ntr|odont|org|pro|prof|psic|psiq|pub|rio|rrpp|sal|tech|tul|tur|uio|vet|xxx",
  "ee": "aip|com|edu|fie|gov|lib|med|org|pri|riik",
  "eg": "ac|com|edu|eun|gov|info|me|mil|name|net|org|sci|sport|tv",
  "er": "*",
  "es": "com|edu|gob|nom|org",
  "et": "biz|com|edu|gov|info|name|net|org",
  "fi": "aland",
  "fj": "ac|biz|com|edu|gov|id|info|mil|name|net|org|pro",
  "fk": "*",
  "fm": "com|edu|net|org",
  "fr": "asso|avoues|cci|com|gouv|greta|huissier-justice|nom|prd|tm",
  "gd": "edu|gov",
  "ge": "com|cyb|edu|gov|llc|net|online|org|pvt|school|tnx",
  "gg": "co|net|org",
  "gh": "biz|com|edu|gov|mil|net|org",
  "gi": "com|edu|gov|ltd|mod|org",
  "gl": "co|com|edu|net|org",
  "gn": "ac|com|edu|gov|net|org",
  "gp": "asso|com|edu|mobi|net|org",
  "gr": "com|edu|gov|net|org",
  "gt": "com|edu|gob|ind|mil|net|org",
  "gu": "com|edu|gov|guam|info|net|org|web",
  "gy": "co|com|edu|gov|net|org",
  "hk": "com|edu|gov|idv|net|org|xn--55qx5d|xn--ciqpn|xn--gmq050i|xn--gmqw5a|xn--io0a7i|xn--lcvr32d|xn--mk0axi|xn--mxtq1m|xn--od0alg|xn--od0aq3b|xn--tn0ag|xn--uc0atv|xn--uc0ay4a|xn--wcvs22d|xn--zf0avx",
  "hn": "com|edu|gob|mil|net|org",
  "hr": "com|from|iz|name",
  "ht": "adult|art|asso|com|coop|edu|firm|gouv|info|med|net|org|perso|pol|pro|rel|shop",
  "hu": "2000|agrar|bolt|casino|city|co|erotica|erotika|film|forum|games|hotel|info|ingatlan|jogasz|konyvelo|lakas|media|news|org|priv|reklam|sex|shop|sport|suli|szex|tm|tozsde|utazas|video",
  "id": "ac|ai|biz|co|desa|go|kop|mil|my|net|or|ponpes|sch|web|xn--9tfky",
  "ie": "gov",
  "il": "ac|co|gov|idf|k12|muni|net|org",
  "im": "ac|co|com|ltd.co|net|org|plc.co|tt|tv",
  "in": "5g|6g|ac|aero|ai|alumni|am|bank|bihar|biz|business|ca|cn|co|com|coop|cs|delhi|dr|edu|er|fin|firm|gen|gov|gujarat|ind|info|int|internet|io|me|mil|net|nic|org|pg|post|pro|res|school|travel|tv|ub|uk|up|us",
  "int": "eu",
  "io": "co|com|edu|gov|mil|net|nom|org",
  "iq": "com|edu|gov|mil|net|org",
  "ir": "ac|co|gov|id|net|org|sch|xn--mgba3a4f16a|xn--mgba3a4fra",
  "it": "abr|abruzzo|ag|agrigento|al|alessandria|alto-adige|altoadige|an|ancona|andria-barletta-trani|andria-trani-barletta|andriabarlettatrani|andriatranibarletta|ao|aosta-valley|aosta|aostavalley|aoste|ap|aq|ar|arezzo|ascoli-piceno|ascolipiceno|asti|at|av|avellino|ba|balsan-sudtirol|balsan-suedtirol|balsan|bari|barletta-trani-andria|barlettatraniandria|bas|basilicata|belluno|benevento|bergamo|bg|bi|biella|bl|bn|bo|bologna|bolzano-altoadige|bolzano|bozen-sudtirol|bozen-suedtirol|bozen|br|brescia|brindisi|bs|bt|bulsan-sudtirol|bulsan-suedtirol|bulsan|bz|ca|cagliari|cal|calabria|caltanissetta|cam|campania|campidano-medio|campidanomedio|campobasso|carbonia-iglesias|carboniaiglesias|carrara-massa|carraramassa|caserta|catania|catanzaro|cb|ce|cesena-forli|cesenaforli|ch|chieti|ci|cl|cn|co|como|cosenza|cr|cremona|crotone|cs|ct|cuneo|cz|dell-ogliastra|dellogliastra|edu|emilia-romagna|emiliaromagna|emr|en|enna|fc|fe|fermo|ferrara|fg|fi|firenze|florence|fm|foggia|forli-cesena|forlicesena|fr|friuli-v-giulia|friuli-ve-giulia|friuli-vegiulia|friuli-venezia-giulia|friuli-veneziagiulia|friuli-vgiulia|friuliv-giulia|friulive-giulia|friulivegiulia|friulivenezia-giulia|friuliveneziagiulia|friulivgiulia|frosinone|fvg|ge|genoa|genova|go|gorizia|gov|gr|grosseto|iglesias-carbonia|iglesiascarbonia|im|imperia|is|isernia|kr|la-spezia|laquila|laspezia|latina|laz|lazio|lc|le|lecce|lecco|li|lig|liguria|livorno|lo|lodi|lom|lombardia|lombardy|lt|lu|lucania|lucca|macerata|mantova|mar|marche|massa-carrara|massacarrara|matera|mb|mc|me|medio-campidano|mediocampidano|messina|mi|milan|milano|mn|mo|modena|mol|molise|monza-brianza|monza-e-della-brianza|monza|monzabrianza|monzaebrianza|monzaedellabrianza|ms|mt|na|naples|napoli|no|novara|nu|nuoro|og|ogliastra|olbia-tempio|olbiatempio|or|oristano|ot|pa|padova|padua|palermo|parma|pavia|pc|pd|pe|perugia|pesaro-urbino|pesarourbino|pescara|pg|pi|piacenza|piedmont|piemonte|pisa|pistoia|pmn|pn|po|pordenone|potenza|pr|prato|pt|pu|pug|puglia|pv|pz|ra|ragusa|ravenna|rc|re|reggio-calabria|reggio-emilia|reggiocalabria|reggioemilia|rg|ri|rieti|rimini|rm|rn|ro|roma|rome|rovigo|sa|salerno|sar|sardegna|sardinia|sassari|savona|si|sic|sicilia|sicily|siena|siracusa|so|sondrio|sp|sr|ss|su|sud-sardegna|sudsardegna|suedtirol|sv|ta|taa|taranto|te|tempio-olbia|tempioolbia|teramo|terni|tn|to|torino|tos|toscana|tp|tr|trani-andria-barletta|trani-barletta-andria|traniandriabarletta|tranibarlettaandria|trapani|trentin-sud-tirol|trentin-sudtirol|trentin-sued-tirol|trentin-suedtirol|trentino-a-adige|trentino-aadige|trentino-alto-adige|trentino-altoadige|trentino-s-tirol|trentino-stirol|trentino-sud-tirol|trentino-sudtirol|trentino-sued-tirol|trentino-suedtirol|trentino|trentinoa-adige|trentinoaadige|trentinoalto-adige|trentinoaltoadige|trentinos-tirol|trentinostirol|trentinosud-tirol|trentinosued-tirol|trentinosuedtirol|trentinsud-tirol|trentinsudtirol|trentinsued-tirol|trentinsuedtirol|trento|treviso|trieste|ts|turin|tuscany|tv|ud|udine|umb|umbria|urbino-pesaro|urbinopesaro|va|val-d-aosta|val-daosta|vald-aosta|valle-aosta|valle-d-aosta|valle-daosta|valleaosta|valled-aosta|valledaosta|vallee-aoste|vallee-d-aoste|valleeaoste|valleedaoste|vao|varese|vb|vc|vda|ve|ven|veneto|venezia|venice|verbania|verbano-cusio-ossola|vercelli|verona|vi|vibo-valentia|vibovalentia|vicenza|viterbo|vr|vs|vt|vv|xn--balsan-sdtirol-nsb|xn--bozen-sdtirol-2ob|xn--bulsan-sdtirol-nsb|xn--cesena-forl-mcb|xn--cesenaforl-i8a|xn--forl-cesena-fcb|xn--forlcesena-c8a|xn--sdtirol-n2a|xn--trentin-sd-tirol-rzb|xn--trentin-sdtirol-7vb|xn--trentino-sd-tirol-c3b|xn--trentino-sdtirol-szb|xn--trentinosd-tirol-rzb|xn--trentinosdtirol-7vb|xn--trentinsd-tirol-6vb|xn--trentinsdtirol-nsb|xn--valle-aoste-ebb|xn--valle-d-aoste-ehb|xn--valleaoste-e7a|xn--valledaoste-ebb",
  "je": "co|net|org",
  "jm": "*",
  "jo": "agri|ai|com|edu|eng|fm|gov|mil|net|org|per|phd|sch|tv",
  "jp": "!city.kawasaki|!city.kitakyushu|!city.kobe|!city.nagoya|!city.sapporo|!city.sendai|!city.yokohama|*.kawasaki|*.kitakyushu|*.kobe|*.nagoya|*.sapporo|*.sendai|*.yokohama|abashiri.hokkaido|abeno.osaka|abiko.chiba|abira.hokkaido|abu.yamaguchi|ac|achi.nagano|ad|adachi.tokyo|aga.niigata|agano.niigata|agematsu.nagano|aguni.okinawa|aibetsu.hokkaido|aichi|aikawa.kanagawa|ainan.ehime|aioi.hyogo|aisai.aichi|aisho.shiga|aizubange.fukushima|aizumi.tokushima|aizumisato.fukushima|aizuwakamatsu.fukushima|akabira.hokkaido|akagi.shimane|akaiwa.okayama|akashi.hyogo|aki.kochi|akiruno.tokyo|akishima.tokyo|akita.akita|akita|akkeshi.hokkaido|ako.hyogo|akune.kagoshima|ama.aichi|ama.shimane|amagasaki.hyogo|amakusa.kumamoto|amami.kagoshima|ami.ibaraki|anamizu.ishikawa|anan.nagano|anan.tokushima|ando.nara|anjo.aichi|annaka.gunma|anpachi.gifu|aogaki.hyogo|aogashima.tokyo|aoki.nagano|aomori.aomori|aomori|arai.shizuoka|arakawa.saitama|arakawa.tokyo|arao.kumamoto|ariake.saga|arida.wakayama|aridagawa.wakayama|arita.saga|asago.hyogo|asahi.chiba|asahi.ibaraki|asahi.mie|asahi.nagano|asahi.toyama|asahi.yamagata|asahikawa.hokkaido|asaka.saitama|asakawa.fukushima|asakuchi.okayama|asaminami.hiroshima|ashibetsu.hokkaido|ashikaga.tochigi|ashiya.fukuoka|ashiya.hyogo|ashoro.hokkaido|aso.kumamoto|assabu.hokkaido|asuke.aichi|atami.shizuoka|atsugi.kanagawa|atsuma.hokkaido|awaji.hyogo|aya.miyazaki|ayabe.kyoto|ayagawa.kagawa|ayase.kanagawa|azumino.nagano|bandai.fukushima|bando.ibaraki|bato.tochigi|beppu.oita|bibai.hokkaido|biei.hokkaido|bifuka.hokkaido|bihoro.hokkaido|biratori.hokkaido|bizen.okayama|bungoono.oita|bungotakada.oita|bunkyo.tokyo|buzen.fukuoka|chiba|chichibu.saitama|chigasaki.kanagawa|chihayaakasaka.osaka|chijiwa.nagasaki|chikugo.fukuoka|chikuho.fukuoka|chikuhoku.nagano|chikujo.fukuoka|chikuma.nagano|chikusei.ibaraki|chikushino.fukuoka|chikuzen.fukuoka|chino.nagano|chippubetsu.hokkaido|chiryu.aichi|chita.aichi|chitose.hokkaido|chiyoda.gunma|chiyoda.tokyo|chizu.tottori|chofu.tokyo|chonan.chiba|chosei.chiba|choshi.chiba|choyo.kumamoto|chuo.chiba|chuo.fukuoka|chuo.osaka|chuo.tokyo|chuo.yamanashi|co|daigo.ibaraki|daisen.akita|daito.osaka|daiwa.hiroshima|date.fukushima|date.hokkaido|dazaifu.fukuoka|doshi.yamanashi|ebetsu.hokkaido|ebina.kanagawa|ebino.miyazaki|echizen.fukui|ed|edogawa.tokyo|ehime|eiheiji.fukui|embetsu.hokkaido|ena.gifu|eniwa.hokkaido|erimo.hokkaido|esan.hokkaido|esashi.hokkaido|etajima.hiroshima|fuchu.hiroshima|fuchu.tokyo|fuchu.toyama|fudai.iwate|fuefuki.yamanashi|fuji.shizuoka|fujieda.shizuoka|fujiidera.osaka|fujikawa.shizuoka|fujikawa.yamanashi|fujikawaguchiko.yamanashi|fujimi.nagano|fujimi.saitama|fujimino.saitama|fujinomiya.shizuoka|fujioka.gunma|fujisato.akita|fujisawa.iwate|fujisawa.kanagawa|fujishiro.ibaraki|fujiyoshida.yamanashi|fukagawa.hokkaido|fukaya.saitama|fukuchi.fukuoka|fukuchiyama.kyoto|fukudomi.saga|fukui.fukui|fukui|fukumitsu.toyama|fukuoka|fukuroi.shizuoka|fukusaki.hyogo|fukushima.fukushima|fukushima.hokkaido|fukushima|fukuyama.hiroshima|funabashi.chiba|funagata.yamagata|funahashi.toyama|furano.hokkaido|furubira.hokkaido|furudono.fukushima|furukawa.miyagi|fuso.aichi|fussa.tokyo|futaba.fukushima|futsu.nagasaki|futtsu.chiba|gamagori.aichi|gamo.shiga|geisei.kochi|genkai.saga|gifu.gifu|gifu|ginan.gifu|ginowan.okinawa|ginoza.okinawa|go|gobo.wakayama|godo.gifu|gojome.akita|gokase.miyazaki|gonohe.aomori|gose.nara|gosen.niigata|goshiki.hyogo|gotemba.shizuoka|goto.nagasaki|gotsu.shimane|gr|gujo.gifu|gunma|gushikami.okinawa|gyokuto.kumamoto|habikino.osaka|haboro.hokkaido|hachijo.tokyo|hachinohe.aomori|hachioji.tokyo|hachirogata.akita|hadano.kanagawa|haebaru.okinawa|haga.tochigi|hagi.yamaguchi|haibara.shizuoka|hakata.fukuoka|hakodate.hokkaido|hakone.kanagawa|hakuba.nagano|hakui.ishikawa|hakusan.ishikawa|hamada.shimane|hamamatsu.shizuoka|hamatama.saga|hamatonbetsu.hokkaido|hamura.tokyo|hanamaki.iwate|hanamigawa.chiba|hanawa.fukushima|handa.aichi|hannan.osaka|hanno.saitama|hanyu.saitama|happou.akita|hara.nagano|harima.hyogo|hasama.oita|hasami.nagasaki|hashikami.aomori|hashima.gifu|hashimoto.wakayama|hasuda.saitama|hatogaya.saitama|hatoyama.saitama|hatsukaichi.hiroshima|hayakawa.yamanashi|hayashima.okayama|hazu.aichi|heguri.nara|hekinan.aichi|hichiso.gifu|hida.gifu|hidaka.hokkaido|hidaka.kochi|hidaka.saitama|hidaka.wakayama|higashi.fukuoka|higashi.fukushima|higashi.okinawa|higashiagatsuma.gunma|higashichichibu.saitama|higashihiroshima.hiroshima|higashiizu.shizuoka|higashiizumo.shimane|higashikagawa.kagawa|higashikagura.hokkaido|higashikawa.hokkaido|higashikurume.tokyo|higashimatsushima.miyagi|higashimatsuyama.saitama|higashimurayama.tokyo|higashinaruse.akita|higashine.yamagata|higashiomi.shiga|higashiosaka.osaka|higashishirakawa.gifu|higashisumiyoshi.osaka|higashitsuno.kochi|higashiura.aichi|higashiyama.kyoto|higashiyamato.tokyo|higashiyodogawa.osaka|higashiyoshino.nara|hiji.oita|hikari.yamaguchi|hikawa.shimane|hikimi.shimane|hikone.shiga|himeji.hyogo|himeshima.oita|himi.toyama|hino.tokyo|hino.tottori|hinode.tokyo|hinohara.tokyo|hioki.kagoshima|hirado.nagasaki|hiraizumi.iwate|hirakata.osaka|hiranai.aomori|hirara.okinawa|hirata.fukushima|hiratsuka.kanagawa|hiraya.nagano|hirogawa.wakayama|hirokawa.fukuoka|hirono.fukushima|hirono.iwate|hiroo.hokkaido|hirosaki.aomori|hiroshima|hisayama.fukuoka|hita.oita|hitachi.ibaraki|hitachinaka.ibaraki|hitachiomiya.ibaraki|hitachiota.ibaraki|hizen.saga|hofu.yamaguchi|hokkaido|hokuryu.hokkaido|hokuto.hokkaido|hokuto.yamanashi|honai.ehime|honbetsu.hokkaido|hongo.hiroshima|honjo.akita|honjo.saitama|honjyo.akita|horokanai.hokkaido|horonobe.hokkaido|hyogo|hyuga.miyazaki|ibara.okayama|ibaraki.ibaraki|ibaraki|ibaraki.osaka|ibigawa.gifu|ichiba.tokushima|ichihara.chiba|ichikai.tochigi|ichikawa.chiba|ichikawa.hyogo|ichikawamisato.yamanashi|ichinohe.iwate|ichinomiya.aichi|ichinomiya.chiba|ichinoseki.iwate|ide.kyoto|iheya.okinawa|iida.nagano|iide.yamagata|iijima.nagano|iitate.fukushima|iiyama.nagano|iizuka.fukuoka|iizuna.nagano|ikaruga.nara|ikata.ehime|ikawa.akita|ikeda.fukui|ikeda.gifu|ikeda.hokkaido|ikeda.nagano|ikeda.osaka|iki.nagasaki|ikoma.nara|ikusaka.nagano|imabari.ehime|imakane.hokkaido|imari.saga|imizu.toyama|ina.ibaraki|ina.nagano|ina.saitama|inabe.mie|inagawa.hyogo|inagi.tokyo|inami.toyama|inami.wakayama|inashiki.ibaraki|inatsuki.fukuoka|inawashiro.fukushima|inazawa.aichi|ine.kyoto|ino.kochi|inuyama.aichi|inzai.chiba|iruma.saitama|isa.kagoshima|isahaya.nagasaki|ise.mie|isehara.kanagawa|isen.kagoshima|isesaki.gunma|ishigaki.okinawa|ishikari.hokkaido|ishikawa.fukushima|ishikawa|ishikawa.okinawa|ishinomaki.miyagi|isshiki.aichi|isumi.chiba|itabashi.tokyo|itako.ibaraki|itakura.gunma|itami.hyogo|itano.tokushima|itayanagi.aomori|ito.shizuoka|itoigawa.niigata|itoman.okinawa|iwade.wakayama|iwafune.tochigi|iwaizumi.iwate|iwaki.fukushima|iwakuni.yamaguchi|iwakura.aichi|iwama.ibaraki|iwamizawa.hokkaido|iwanai.hokkaido|iwanuma.miyagi|iwata.shizuoka|iwate.iwate|iwate|iwatsuki.saitama|iyo.ehime|izena.okinawa|izu.shizuoka|izumi.kagoshima|izumi.osaka|izumiotsu.osaka|izumisano.osaka|izumizaki.fukushima|izumo.shimane|izumozaki.niigata|izunokuni.shizuoka|jinsekikogen.hiroshima|joboji.iwate|joetsu.niigata|johana.toyama|joso.ibaraki|joyo.kyoto|kadena.okinawa|kadogawa.miyazaki|kadoma.osaka|kaga.ishikawa|kagami.kochi|kagamiishi.fukushima|kagamino.okayama|kagawa|kagoshima|kagoshima.kagoshima|kaho.fukuoka|kahoku.ishikawa|kahoku.yamagata|kai.yamanashi|kainan.tokushima|kainan.wakayama|kaisei.kanagawa|kaita.hiroshima|kaizuka.osaka|kakamigahara.gifu|kakegawa.shizuoka|kakinoki.shimane|kakogawa.hyogo|kakuda.miyagi|kamagaya.chiba|kamaishi.iwate|kamakura.kanagawa|kameoka.kyoto|kameyama.mie|kami.kochi|kami.miyagi|kamiamakusa.kumamoto|kamifurano.hokkaido|kamigori.hyogo|kamiichi.toyama|kamiizumi.saitama|kamijima.ehime|kamikawa.hokkaido|kamikawa.hyogo|kamikawa.saitama|kamikitayama.nara|kamikoani.akita|kamimine.saga|kaminokawa.tochigi|kaminoyama.yamagata|kamioka.akita|kamisato.saitama|kamishihoro.hokkaido|kamisu.ibaraki|kamisunagawa.hokkaido|kamitonda.wakayama|kamitsue.oita|kamo.kyoto|kamo.niigata|kamoenai.hokkaido|kamogawa.chiba|kanagawa|kanan.osaka|kanazawa.ishikawa|kanegasaki.iwate|kaneyama.fukushima|kaneyama.yamagata|kani.gifu|kanie.aichi|kanmaki.nara|kanna.gunma|kannami.shizuoka|kanonji.kagawa|kanoya.kagoshima|kanra.gunma|kanuma.tochigi|kanzaki.saga|karasuyama.tochigi|karatsu.saga|kariwa.niigata|kariya.aichi|karuizawa.nagano|karumai.iwate|kasahara.gifu|kasai.hyogo|kasama.ibaraki|kasamatsu.gifu|kasaoka.okayama|kashiba.nara|kashihara.nara|kashima.ibaraki|kashima.saga|kashiwa.chiba|kashiwara.osaka|kashiwazaki.niigata|kasuga.fukuoka|kasuga.hyogo|kasugai.aichi|kasukabe.saitama|kasumigaura.ibaraki|kasuya.fukuoka|katagami.akita|katano.osaka|katashina.gunma|katori.chiba|katsuragi.nara|katsuragi.wakayama|katsushika.tokyo|katsuura.chiba|katsuyama.fukui|kawaba.gunma|kawachinagano.osaka|kawagoe.mie|kawagoe.saitama|kawaguchi.saitama|kawahara.tottori|kawai.iwate|kawai.nara|kawajima.saitama|kawakami.nagano|kawakami.nara|kawakita.ishikawa|kawamata.fukushima|kawaminami.miyazaki|kawanabe.kagoshima|kawanehon.shizuoka|kawanishi.hyogo|kawanishi.nara|kawanishi.yamagata|kawara.fukuoka|kawasaki.miyagi|kawatana.nagasaki|kawaue.gifu|kawazu.shizuoka|kayabe.hokkaido|kazo.saitama|kazuno.akita|keisen.fukuoka|kembuchi.hokkaido|kibichuo.okayama|kiho.mie|kihoku.ehime|kijo.miyazaki|kikonai.hokkaido|kikuchi.kumamoto|kikugawa.shizuoka|kimino.wakayama|kimitsu.chiba|kimobetsu.hokkaido|kin.okinawa|kinko.kagoshima|kinokawa.wakayama|kira.aichi|kiryu.gunma|kisarazu.chiba|kishiwada.osaka|kiso.nagano|kisofukushima.nagano|kisosaki.mie|kita.kyoto|kita.osaka|kita.tokyo|kitaaiki.nagano|kitaakita.akita|kitadaito.okinawa|kitagata.gifu|kitagata.saga|kitagawa.kochi|kitagawa.miyazaki|kitahata.saga|kitahiroshima.hokkaido|kitakami.iwate|kitakata.fukushima|kitakata.miyazaki|kitami.hokkaido|kitamoto.saitama|kitanakagusuku.okinawa|kitashiobara.fukushima|kitaura.miyazaki|kitayama.wakayama|kiwa.mie|kiyama.saga|kiyokawa.kanagawa|kiyosato.hokkaido|kiyose.tokyo|kiyosu.aichi|kizu.kyoto|kobayashi.miyazaki|kochi|kochi.kochi|kodaira.tokyo|kofu.yamanashi|koga.fukuoka|koga.ibaraki|koganei.tokyo|koge.tottori|koka.shiga|kokonoe.oita|kokubunji.tokyo|komae.tokyo|komagane.nagano|komaki.aichi|komatsu.ishikawa|komatsushima.tokushima|komono.mie|komoro.nagano|konan.aichi|konan.shiga|koori.fukushima|koriyama.fukushima|koryo.nara|kosai.shizuoka|kosaka.akita|kosei.shiga|koshigaya.saitama|koshimizu.hokkaido|koshu.yamanashi|kosuge.yamanashi|kota.aichi|koto.shiga|koto.tokyo|kotohira.kagawa|kotoura.tottori|kouhoku.saga|kounosu.saitama|kouyama.kagoshima|kouzushima.tokyo|koya.wakayama|koza.wakayama|kozagawa.wakayama|kozaki.chiba|kuchinotsu.nagasaki|kudamatsu.yamaguchi|kudoyama.wakayama|kui.hiroshima|kuji.iwate|kuju.oita|kujukuri.chiba|kuki.saitama|kumagaya.saitama|kumakogen.ehime|kumamoto|kumamoto.kumamoto|kumano.hiroshima|kumano.mie|kumatori.osaka|kumejima.okinawa|kumenan.okayama|kumiyama.kyoto|kunigami.okinawa|kunimi.fukushima|kunisaki.oita|kunitachi.tokyo|kunitomi.miyazaki|kunneppu.hokkaido|kunohe.iwate|kurashiki.okayama|kurate.fukuoka|kure.hiroshima|kuriyama.hokkaido|kurobe.toyama|kurogi.fukuoka|kuroishi.aomori|kuroiso.tochigi|kuromatsunai.hokkaido|kurotaki.nara|kurume.fukuoka|kusatsu.gunma|kusatsu.shiga|kushima.miyazaki|kushimoto.wakayama|kushiro.hokkaido|kusu.oita|kutchan.hokkaido|kuwana.mie|kuzumaki.iwate|kyonan.chiba|kyotamba.kyoto|kyotanabe.kyoto|kyotango.kyoto|kyoto|kyowa.akita|kyowa.hokkaido|kyuragi.saga|lg|machida.tokyo|maebashi.gunma|maibara.shiga|maizuru.kyoto|makinohara.shizuoka|makurazaki.kagoshima|mamurogawa.yamagata|maniwa.okayama|manno.kagawa|marugame.kagawa|marumori.miyagi|masaki.ehime|mashike.hokkaido|mashiki.kumamoto|mashiko.tochigi|masuda.shimane|matsubara.osaka|matsubushi.saitama|matsuda.kanagawa|matsudo.chiba|matsue.shimane|matsukawa.nagano|matsumae.hokkaido|matsumoto.kagoshima|matsumoto.nagano|matsuno.ehime|matsusaka.mie|matsushige.tokushima|matsushima.miyagi|matsuura.nagasaki|matsuyama.ehime|matsuzaki.shizuoka|meguro.tokyo|meiwa.gunma|meiwa.mie|miasa.nagano|mibu.tochigi|midori.chiba|midori.gunma|mie|mifune.kumamoto|mihama.aichi|mihama.chiba|mihama.fukui|mihama.mie|mihama.wakayama|mihara.hiroshima|mihara.kochi|miharu.fukushima|miho.ibaraki|mikasa.hokkaido|mikawa.yamagata|miki.hyogo|mima.tokushima|mimata.miyazaki|minakami.gunma|minamata.kumamoto|minami-alps.yamanashi|minami.fukuoka|minami.kyoto|minami.tokushima|minamiaiki.nagano|minamiashigara.kanagawa|minamiawaji.hyogo|minamiboso.chiba|minamidaito.okinawa|minamiechizen.fukui|minamifurano.hokkaido|minamiise.mie|minamiizu.shizuoka|minamimaki.nagano|minamiminowa.nagano|minamioguni.kumamoto|minamisanriku.miyagi|minamitane.kagoshima|minamiuonuma.niigata|minamiyamashiro.kyoto|minano.saitama|minato.osaka|minato.tokyo|mino.gifu|minobu.yamanashi|minoh.osaka|minokamo.gifu|minowa.nagano|misaki.okayama|misaki.osaka|misasa.tottori|misato.akita|misato.miyagi|misato.saitama|misato.shimane|misato.wakayama|misawa.aomori|mishima.fukushima|mishima.shizuoka|misugi.mie|mitaka.tokyo|mitake.gifu|mitane.akita|mito.ibaraki|mitou.yamaguchi|mitoyo.kagawa|mitsue.nara|mitsuke.niigata|miura.kanagawa|miyada.nagano|miyagi|miyake.nara|miyako.fukuoka|miyako.iwate|miyakonojo.miyazaki|miyama.fukuoka|miyama.mie|miyashiro.saitama|miyawaka.fukuoka|miyazaki|miyazaki.miyazaki|miyazu.kyoto|miyoshi.aichi|miyoshi.hiroshima|miyoshi.saitama|miyoshi.tokushima|miyota.nagano|mizuho.tokyo|mizumaki.fukuoka|mizunami.gifu|mizusawa.iwate|mobara.chiba|mochizuki.nagano|moka.tochigi|mombetsu.hokkaido|moriguchi.osaka|morimachi.shizuoka|morioka.iwate|moriya.ibaraki|moriyama.shiga|moriyoshi.akita|morotsuka.miyazaki|moroyama.saitama|moseushi.hokkaido|motegi.tochigi|motobu.okinawa|motosu.gifu|motoyama.kochi|mugi.tokushima|muika.niigata|mukawa.hokkaido|muko.kyoto|munakata.fukuoka|murakami.niigata|murata.miyagi|murayama.yamagata|muroran.hokkaido|muroto.kochi|musashimurayama.tokyo|musashino.tokyo|mutsu.aomori|mutsuzawa.chiba|myoko.niigata|nabari.mie|nachikatsuura.wakayama|nagahama.shiga|nagai.yamagata|nagano|nagano.nagano|naganohara.gunma|nagaoka.niigata|nagaokakyo.kyoto|nagara.chiba|nagareyama.chiba|nagasaki|nagasaki.nagasaki|nagasu.kumamoto|nagato.yamaguchi|nagatoro.saitama|nagawa.nagano|nagi.okayama|nagiso.nagano|nago.okinawa|naha.okinawa|nahari.kochi|naie.hokkaido|naka.hiroshima|naka.ibaraki|nakadomari.aomori|nakagawa.fukuoka|nakagawa.hokkaido|nakagawa.nagano|nakagawa.tokushima|nakagusuku.okinawa|nakagyo.kyoto|nakai.kanagawa|nakama.fukuoka|nakamichi.yamanashi|nakamura.kochi|nakaniikawa.toyama|nakano.nagano|nakano.tokyo|nakanojo.gunma|nakanoto.ishikawa|nakasatsunai.hokkaido|nakatane.kagoshima|nakatombetsu.hokkaido|nakatsugawa.gifu|nakayama.yamagata|nakijin.okinawa|namegata.ibaraki|namegawa.saitama|namerikawa.toyama|namie.fukushima|namikata.ehime|nanae.hokkaido|nanao.ishikawa|nanbu.tottori|nanbu.yamanashi|nango.fukushima|nanjo.okinawa|nankoku.kochi|nanmoku.gunma|nanporo.hokkaido|nantan.kyoto|nanto.toyama|nanyo.yamagata|naoshima.kagawa|nara|nara.nara|narashino.chiba|narita.chiba|narusawa.yamanashi|naruto.tokushima|nasu.tochigi|nasushiobara.tochigi|natori.miyagi|nayoro.hokkaido|ne|nemuro.hokkaido|nerima.tokyo|neyagawa.osaka|nichinan.miyazaki|nichinan.tottori|niigata|niigata.niigata|niihama.ehime|niikappu.hokkaido|niimi.okayama|niiza.saitama|nikaho.akita|niki.hokkaido|nikko.tochigi|ninohe.iwate|ninomiya.kanagawa|nirasaki.yamanashi|nishi.fukuoka|nishi.osaka|nishiaizu.fukushima|nishiarita.saga|nishiawakura.okayama|nishiazai.shiga|nishigo.fukushima|nishihara.kumamoto|nishihara.okinawa|nishiizu.shizuoka|nishikata.tochigi|nishikatsura.yamanashi|nishikawa.yamagata|nishimera.miyazaki|nishinomiya.hyogo|nishinoomote.kagoshima|nishinoshima.shimane|nishio.aichi|nishiokoppe.hokkaido|nishitosa.kochi|nishiwaki.hyogo|nisshin.aichi|niyodogawa.kochi|nobeoka.miyazaki|noboribetsu.hokkaido|noda.chiba|noda.iwate|nogata.fukuoka|nogi.tochigi|noheji.aomori|nomi.ishikawa|nonoichi.ishikawa|nose.osaka|nosegawa.nara|noshiro.akita|noto.ishikawa|notogawa.shiga|nozawaonsen.nagano|numata.gunma|numata.hokkaido|numazu.shizuoka|nyuzen.toyama|oamishirasato.chiba|oarai.ibaraki|obama.fukui|obama.nagasaki|obanazawa.yamagata|obihiro.hokkaido|obira.hokkaido|obu.aichi|obuse.nagano|ochi.kochi|odate.akita|odawara.kanagawa|oe.yamagata|ofunato.iwate|oga.akita|ogaki.gifu|ogano.saitama|ogasawara.tokyo|ogata.akita|ogawa.ibaraki|ogawa.nagano|ogawa.saitama|ogawara.miyagi|ogi.saga|ogimi.okinawa|ogori.fukuoka|ogose.saitama|oguchi.aichi|oguni.kumamoto|oguni.yamagata|oharu.aichi|ohda.shimane|ohi.fukui|ohira.miyagi|ohira.tochigi|ohkura.yamagata|ohtawara.tochigi|oi.kanagawa|oirase.aomori|oishida.yamagata|oiso.kanagawa|oita|oita.oita|oizumi.gunma|oji.nara|ojiya.niigata|okagaki.fukuoka|okawa.fukuoka|okawa.kochi|okaya.nagano|okayama|okayama.okayama|okazaki.aichi|okegawa.saitama|oketo.hokkaido|oki.fukuoka|okinawa|okinawa.okinawa|okinoshima.shimane|okoppe.hokkaido|okuizumo.shimane|okuma.fukushima|okutama.tokyo|omachi.nagano|omachi.saga|omaezaki.shizuoka|ome.tokyo|omi.nagano|omi.niigata|omigawa.chiba|omihachiman.shiga|omitama.ibaraki|omiya.saitama|omotego.fukushima|omura.nagasaki|omuta.fukuoka|onagawa.miyagi|onga.fukuoka|onjuku.chiba|onna.okinawa|ono.fukui|ono.fukushima|ono.hyogo|onojo.fukuoka|onomichi.hiroshima|ookuwa.nagano|ooshika.nagano|or|ora.gunma|osaka|osakasayama.osaka|osaki.miyagi|osakikamijima.hiroshima|oseto.nagasaki|oshima.tokyo|oshima.yamaguchi|oshino.yamanashi|oshu.iwate|ota.gunma|ota.tokyo|otake.hiroshima|otaki.chiba|otaki.nagano|otaki.saitama|otama.fukushima|otari.nagano|otaru.hokkaido|oto.fukuoka|otobe.hokkaido|otofuke.hokkaido|otoineppu.hokkaido|otoyo.kochi|otsu.shiga|otsuchi.iwate|otsuki.kochi|otsuki.yamanashi|ouchi.saga|ouda.nara|oumu.hokkaido|owani.aomori|owariasahi.aichi|oyabe.toyama|oyama.tochigi|oyamazaki.kyoto|oyodo.nara|ozora.hokkaido|ozu.ehime|ozu.kumamoto|pippu.hokkaido|rankoshi.hokkaido|ranzan.saitama|rebun.hokkaido|rifu.miyagi|rikubetsu.hokkaido|rikuzentakata.iwate|rishiri.hokkaido|rishirifuji.hokkaido|ritto.shiga|rokunohe.aomori|ryokami.saitama|ryugasaki.ibaraki|ryuoh.shiga|sabae.fukui|sado.niigata|saga|saga.saga|sagae.yamagata|sagamihara.kanagawa|saigawa.fukuoka|saijo.ehime|saikai.nagasaki|saiki.oita|saitama|saitama.saitama|saito.miyazaki|saka.hiroshima|sakado.saitama|sakae.chiba|sakae.nagano|sakahogi.gifu|sakai.fukui|sakai.ibaraki|sakai.osaka|sakaiminato.tottori|sakaki.nagano|sakata.yamagata|sakawa.kochi|sakegawa.yamagata|saku.nagano|sakuho.nagano|sakura.chiba|sakura.tochigi|sakuragawa.ibaraki|sakurai.nara|sakyo.kyoto|samegawa.fukushima|samukawa.kanagawa|sanagochi.tokushima|sanda.hyogo|sango.nara|sanjo.niigata|sannan.hyogo|sannohe.aomori|sano.tochigi|sanuki.kagawa|saroma.hokkaido|sarufutsu.hokkaido|sasaguri.fukuoka|sasayama.hyogo|sasebo.nagasaki|satosho.okayama|satsumasendai.kagoshima|satte.saitama|sayama.osaka|sayama.saitama|sayo.hyogo|seihi.nagasaki|seika.kyoto|seiro.niigata|seirou.niigata|seiyo.ehime|seki.gifu|sekigahara.gifu|sekikawa.niigata|semboku.akita|semine.miyagi|sennan.osaka|sera.hiroshima|seranishi.hiroshima|setagaya.tokyo|seto.aichi|setouchi.okayama|settsu.osaka|shakotan.hokkaido|shari.hokkaido|shibata.miyagi|shibata.niigata|shibecha.hokkaido|shibetsu.hokkaido|shibukawa.gunma|shibuya.tokyo|shichikashuku.miyagi|shichinohe.aomori|shiga|shiiba.miyazaki|shijonawate.osaka|shika.ishikawa|shikabe.hokkaido|shikama.miyagi|shikaoi.hokkaido|shikatsu.aichi|shiki.saitama|shikokuchuo.ehime|shima.mie|shimabara.nagasaki|shimada.shizuoka|shimamaki.hokkaido|shimamoto.osaka|shimane|shimane.shimane|shimizu.hokkaido|shimizu.shizuoka|shimoda.shizuoka|shimodate.ibaraki|shimofusa.chiba|shimogo.fukushima|shimoichi.nara|shimoji.okinawa|shimokawa.hokkaido|shimokitayama.nara|shimonita.gunma|shimonoseki.yamaguchi|shimosuwa.nagano|shimotsuke.tochigi|shimotsuma.ibaraki|shinagawa.tokyo|shinanomachi.nagano|shingo.aomori|shingu.fukuoka|shingu.hyogo|shingu.wakayama|shinichi.hiroshima|shinjo.nara|shinjo.okayama|shinjo.yamagata|shinjuku.tokyo|shinkamigoto.nagasaki|shinonsen.hyogo|shinshinotsu.hokkaido|shinshiro.aichi|shinto.gunma|shintoku.hokkaido|shintomi.miyazaki|shinyoshitomi.fukuoka|shiogama.miyagi|shiojiri.nagano|shioya.tochigi|shirahama.wakayama|shirakawa.fukushima|shirakawa.gifu|shirako.chiba|shiranuka.hokkaido|shiraoi.hokkaido|shiraoka.saitama|shirataka.yamagata|shiriuchi.hokkaido|shiroi.chiba|shiroishi.miyagi|shiroishi.saga|shirosato.ibaraki|shishikui.tokushima|shiso.hyogo|shisui.chiba|shitara.aichi|shiwa.iwate|shizukuishi.iwate|shizuoka|shizuoka.shizuoka|shobara.hiroshima|shonai.fukuoka|shonai.yamagata|shoo.okayama|showa.fukushima|showa.gunma|showa.yamanashi|shunan.yamaguchi|sobetsu.hokkaido|sodegaura.chiba|soeda.fukuoka|soja.okayama|soka.saitama|soma.fukushima|soni.nara|soo.kagoshima|sosa.chiba|sowa.ibaraki|sue.fukuoka|suginami.tokyo|sugito.saitama|suifu.ibaraki|suita.osaka|sukagawa.fukushima|sukumo.kochi|sumida.tokyo|sumita.iwate|sumoto.hyogo|sumoto.kumamoto|sunagawa.hokkaido|susaki.kochi|susono.shizuoka|suwa.nagano|suzaka.nagano|suzu.ishikawa|suzuka.mie|tabayama.yamanashi|tabuse.yamaguchi|tachiarai.fukuoka|tachikawa.tokyo|tadaoka.osaka|tado.mie|tadotsu.kagawa|tagajo.miyagi|tagami.niigata|tagawa.fukuoka|tahara.aichi|taiji.wakayama|taiki.hokkaido|taiki.mie|tainai.niigata|taira.toyama|taishi.hyogo|taishi.osaka|taishin.fukushima|taito.tokyo|taiwa.miyagi|tajimi.gifu|tajiri.osaka|taka.hyogo|takagi.nagano|takahagi.ibaraki|takahama.aichi|takahama.fukui|takaharu.miyazaki|takahashi.okayama|takahata.yamagata|takaishi.osaka|takamatsu.kagawa|takamori.kumamoto|takamori.nagano|takanabe.miyazaki|takanezawa.tochigi|takaoka.toyama|takarazuka.hyogo|takasago.hyogo|takasaki.gunma|takashima.shiga|takasu.hokkaido|takata.fukuoka|takatori.nara|takatsuki.osaka|takatsuki.shiga|takayama.gifu|takayama.gunma|takayama.nagano|takazaki.miyazaki|takehara.hiroshima|taketa.oita|taketomi.okinawa|taki.mie|takikawa.hokkaido|takino.hyogo|takinoue.hokkaido|takko.aomori|tako.chiba|taku.saga|tama.tokyo|tamakawa.fukushima|tamaki.mie|tamamura.gunma|tamano.okayama|tamatsukuri.ibaraki|tamayu.shimane|tamba.hyogo|tanabe.kyoto|tanabe.wakayama|tanagura.fukushima|tanohata.iwate|tara.saga|tarama.okinawa|tarui.gifu|tarumizu.kagoshima|tatebayashi.gunma|tateshina.nagano|tateyama.chiba|tateyama.toyama|tatsuno.hyogo|tatsuno.nagano|tawaramoto.nara|tendo.yamagata|tenei.fukushima|tenkawa.nara|tenri.nara|teshikaga.hokkaido|toba.mie|tobe.ehime|tobetsu.hokkaido|tobishima.aichi|tochigi|tochigi.tochigi|tochio.niigata|toda.saitama|toei.aichi|toga.toyama|togakushi.nagano|togane.chiba|togitsu.nagasaki|togo.aichi|togura.nagano|tohma.hokkaido|tohnosho.chiba|toho.fukuoka|tokai.aichi|tokai.ibaraki|tokamachi.niigata|tokashiki.okinawa|toki.gifu|tokigawa.saitama|tokoname.aichi|tokorozawa.saitama|tokushima|tokushima.tokushima|tokuyama.yamaguchi|tokyo|tomakomai.hokkaido|tomari.hokkaido|tome.miyagi|tomi.nagano|tomigusuku.okinawa|tomika.gifu|tomioka.gunma|tomisato.chiba|tomiya.miyagi|tomobe.ibaraki|tonaki.okinawa|tonami.toyama|tondabayashi.osaka|tone.ibaraki|tono.iwate|tonosho.kagawa|toon.ehime|torahime.shiga|toride.ibaraki|tosa.kochi|tosashimizu.kochi|toshima.tokyo|tosu.saga|tottori|tottori.tottori|towada.aomori|toya.hokkaido|toyako.hokkaido|toyama|toyama.toyama|toyo.kochi|toyoake.aichi|toyohashi.aichi|toyokawa.aichi|toyonaka.osaka|toyone.aichi|toyono.osaka|toyooka.hyogo|toyosato.shiga|toyota.aichi|toyota.yamaguchi|toyotomi.hokkaido|toyotsu.fukuoka|toyoura.hokkaido|tozawa.yamagata|tsu.mie|tsubame.niigata|tsubata.ishikawa|tsubetsu.hokkaido|tsuchiura.ibaraki|tsuga.tochigi|tsugaru.aomori|tsuiki.fukuoka|tsukigata.hokkaido|tsukiyono.gunma|tsukuba.ibaraki|tsukui.kanagawa|tsukumi.oita|tsumagoi.gunma|tsunan.niigata|tsuno.kochi|tsuno.miyazaki|tsuru.yamanashi|tsuruga.fukui|tsurugashima.saitama|tsurugi.ishikawa|tsuruoka.yamagata|tsuruta.aomori|tsushima.aichi|tsushima.nagasaki|tsuwano.shimane|tsuyama.okayama|ube.yamaguchi|uchihara.ibaraki|uchiko.ehime|uchinada.ishikawa|uchinomi.kagawa|uda.nara|udono.mie|ueda.nagano|ueno.gunma|uenohara.yamanashi|uji.kyoto|ujiie.tochigi|ujitawara.kyoto|uki.kumamoto|ukiha.fukuoka|umaji.kochi|umi.fukuoka|unazuki.toyama|unnan.shimane|unzen.nagasaki|uonuma.niigata|uozu.toyama|urakawa.hokkaido|urasoe.okinawa|urausu.hokkaido|urawa.saitama|urayasu.chiba|ureshino.mie|uruma.okinawa|uryu.hokkaido|usa.oita|ushiku.ibaraki|usui.fukuoka|usuki.oita|utashinai.hokkaido|utazu.kagawa|uto.kumamoto|utsunomiya.tochigi|uwajima.ehime|wada.nagano|wajiki.tokushima|wajima.ishikawa|wakasa.fukui|wakasa.tottori|wakayama|wakayama.wakayama|wake.okayama|wakkanai.hokkaido|wakuya.miyagi|wanouchi.gifu|warabi.saitama|wassamu.hokkaido|watarai.mie|watari.miyagi|wazuka.kyoto|xn--0trq7p7nn|xn--1ctwo|xn--1lqs03n|xn--1lqs71d|xn--2m4a15e|xn--32vp30h|xn--4it168d|xn--4it797k|xn--4pvxs|xn--5js045d|xn--5rtp49c|xn--5rtq34k|xn--6btw5a|xn--6orx2r|xn--7t0a264c|xn--8ltr62k|xn--8pvr4u|xn--c3s14m|xn--d5qv7z876c|xn--djrs72d6uy|xn--djty4k|xn--efvn9s|xn--ehqz56n|xn--elqq16h|xn--f6qx53a|xn--k7yn95e|xn--kbrq7o|xn--klt787d|xn--kltp7d|xn--kltx9a|xn--klty5x|xn--mkru45i|xn--nit225k|xn--ntso0iqx3a|xn--ntsq17g|xn--pssu33l|xn--qqqt11m|xn--rht27z|xn--rht3d|xn--rht61e|xn--rny31h|xn--tor131o|xn--uist22h|xn--uisz3g|xn--uuwu58a|xn--vgu402c|xn--zbx025d|yabu.hyogo|yabuki.fukushima|yachimata.chiba|yachiyo.chiba|yachiyo.ibaraki|yaese.okinawa|yahaba.iwate|yahiko.niigata|yaita.tochigi|yaizu.shizuoka|yakage.okayama|yakumo.hokkaido|yakumo.shimane|yamada.fukuoka|yamada.iwate|yamada.toyama|yamaga.kumamoto|yamagata.gifu|yamagata.ibaraki|yamagata|yamagata.nagano|yamagata.yamagata|yamaguchi|yamakita.kanagawa|yamamoto.miyagi|yamanakako.yamanashi|yamanashi|yamanashi.yamanashi|yamanobe.yamagata|yamanouchi.nagano|yamashina.kyoto|yamato.fukushima|yamato.kanagawa|yamato.kumamoto|yamatokoriyama.nara|yamatotakada.nara|yamatsuri.fukushima|yamazoe.nara|yame.fukuoka|yanagawa.fukuoka|yanaizu.fukushima|yao.osaka|yaotsu.gifu|yasaka.nagano|yashio.saitama|yashiro.hyogo|yasu.shiga|yasuda.kochi|yasugi.shimane|yasuoka.nagano|yatomi.aichi|yatsuka.shimane|yatsushiro.kumamoto|yawara.ibaraki|yawata.kyoto|yawatahama.ehime|yazu.tottori|yoichi.hokkaido|yoita.niigata|yoka.hyogo|yokaichiba.chiba|yokawa.hyogo|yokkaichi.mie|yokoshibahikari.chiba|yokosuka.kanagawa|yokote.akita|yokoze.saitama|yomitan.okinawa|yonabaru.okinawa|yonago.tottori|yonaguni.okinawa|yonezawa.yamagata|yono.saitama|yorii.saitama|yoro.gifu|yoshida.saitama|yoshida.shizuoka|yoshikawa.saitama|yoshimi.saitama|yoshino.nara|yoshinogari.saga|yoshioka.gunma|yotsukaido.chiba|yuasa.wakayama|yufu.oita|yugawa.fukushima|yugawara.kanagawa|yuki.ibaraki|yukuhashi.fukuoka|yura.wakayama|yurihonjo.akita|yusuhara.kochi|yusui.kagoshima|yuu.yamaguchi|yuza.yamagata|yuzawa.niigata|zama.kanagawa|zamami.okinawa|zao.miyagi|zentsuji.kagawa|zushi.kanagawa",
  "ke": "ac|co|go|info|me|mobi|ne|or|sc",
  "kg": "com|edu|gov|mil|net|org",
  "kh": "com|edu|gov|net|org",
  "ki": "biz|com|edu|gov|info|net|org",
  "km": "ass|asso|com|coop|edu|gouv|gov|medecin|mil|nom|notaires|org|pharmaciens|prd|presse|tm|veterinaire",
  "kn": "edu|gov|net|org",
  "kp": "com|edu|gov|org|rep|tra",
  "kr": "ac|ai|busan|chungbuk|chungnam|co|daegu|daejeon|es|gangwon|go|gwangju|gyeongbuk|gyeonggi|gyeongnam|hs|incheon|io|it|jeju|jeonbuk|jeonnam|kg|me|mil|ms|ne|or|pe|re|sc|seoul|ulsan",
  "kw": "com|edu|emb|gov|ind|net|org",
  "ky": "com|edu|net|org",
  "kz": "com|edu|gov|mil|net|org",
  "la": "com|edu|gov|info|int|net|org|per",
  "lb": "com|edu|gov|net|org",
  "lc": "co|com|edu|gov|net|org",
  "lk": "ac|assn|com|edu|gov|grp|hotel|int|ltd|net|ngo|org|sch|soc|web",
  "lr": "com|edu|gov|net|org",
  "ls": "ac|biz|co|edu|gov|info|net|org|sc",
  "lt": "gov",
  "lv": "asn|com|conf|edu|gov|id|mil|net|org",
  "ly": "com|edu|gov|id|med|net|org|plc|sch",
  "ma": "ac|co|gov|net|org|press",
  "mc": "asso|tm",
  "me": "ac|co|edu|gov|its|net|org|priv",
  "mg": "co|com|edu|gov|mil|nom|org|prd",
  "mk": "com|edu|gov|inf|name|net|org",
  "ml": "ac|art|asso|com|edu|gouv|gov|info|inst|net|org|pr|presse",
  "mm": "*",
  "mn": "edu|gov|org",
  "mo": "com|edu|gov|net|org",
  "mr": "gov",
  "ms": "com|edu|gov|net|org",
  "mt": "com|edu|net|org",
  "mu": "ac|co|com|gov|net|or|org",
  "mv": "aero|biz|com|coop|edu|gov|info|int|mil|museum|name|net|org|pro",
  "mw": "ac|biz|co|com|coop|edu|gov|int|net|org",
  "mx": "com|edu|gob|net|org",
  "my": "biz|com|edu|gov|mil|name|net|org",
  "mz": "ac|adv|co|edu|gov|mil|net|org",
  "na": "alt|co|com|gov|net|org",
  "nc": "asso|nom",
  "nf": "arts|com|firm|info|net|other|per|rec|store|web",
  "ng": "com|edu|gov|i|mil|mobi|name|net|org|sch",
  "ni": "ac|biz|co|com|edu|gob|in|info|int|mil|net|nom|org|web",
  "no": "aa|aarborte|aejrie|afjord|agdenes|ah|aknoluokta|akrehamn|al|alaheadju|alesund|algard|alstahaug|alta|alvdal|amli|amot|andasuolo|andebu|andoy|ardal|aremark|arendal|arna|aseral|asker|askim|askoy|askvoll|asnes|audnedal|aukra|aure|aurland|aurskog-holand|austevoll|austrheim|averoy|badaddja|bahcavuotna|bahccavuotna|baidar|bajddar|balat|balestrand|ballangen|balsfjord|bamble|bardu|barum|batsfjord|bearalvahki|beardu|beiarn|berg|bergen|berlevag|bievat|bindal|birkenes|bjerkreim|bjugn|bo.nordland|bo.telemark|bodo|bokn|bomlo|bremanger|bronnoy|bronnoysund|brumunddal|bryne|bu|budejju|bygland|bykle|cahcesuolo|davvenjarga|davvesiida|deatnu|dep|dielddanuorri|divtasvuodna|divttasvuotna|donna|dovre|drammen|drangedal|drobak|dyroy|egersund|eid|eidfjord|eidsberg|eidskog|eidsvoll|eigersund|elverum|enebakk|engerdal|etne|etnedal|evenassi|evenes|evje-og-hornnes|farsund|fauske|fedje|fet|fetsund|fhs|finnoy|fitjar|fjaler|fjell|fla|flakstad|flatanger|flekkefjord|flesberg|flora|floro|fm|folkebibl|folldal|forde|forsand|fosnes|frana|fredrikstad|frogn|froland|frosta|froya|fuoisku|fuossko|fusa|fylkesbibl|fyresdal|gaivuotna|galsa|gamvik|gangaviika|gaular|gausdal|giehtavuoatna|gielda|gildeskal|giske|gjemnes|gjerdrum|gjerstad|gjesdal|gjovik|gloppen|gol|gran|grane|granvin|gratangen|grimstad|grong|grue|gs.aa|gs.ah|gs.bu|gs.fm|gs.hl|gs.hm|gs.jan-mayen|gs.mr|gs.nl|gs.nt|gs.of|gs.ol|gs.oslo|gs.rl|gs.sf|gs.st|gs.svalbard|gs.tm|gs.tr|gs.va|gs.vf|gulen|guovdageaidnu|ha|habmer|hadsel|hagebostad|halden|halsa|hamar|hamaroy|hammarfeasta|hammerfest|hapmir|haram|hareid|harstad|hasvik|hattfjelldal|haugesund|hemne|hemnes|hemsedal|herad|heroy.more-og-romsdal|heroy.nordland|hitra|hjartdal|hjelmeland|hl|hm|hobol|hof|hokksund|hol|hole|holmestrand|holtalen|honefoss|hornindal|horten|hoyanger|hoylandet|hurdal|hurum|hvaler|hyllestad|ibestad|idrett|inderoy|iveland|ivgu|jan-mayen|jessheim|jevnaker|jolster|jondal|jorpeland|kafjord|karasjohka|karasjok|karlsoy|karmoy|kautokeino|kirkenes|klabu|klepp|kommune|kongsberg|kongsvinger|kopervik|kraanghke|kragero|kristiansand|kristiansund|krodsherad|krokstadelva|kvafjord|kvalsund|kvam|kvanangen|kvinesdal|kvinnherad|kviteseid|kvitsoy|laakesvuemie|lahppi|langevag|lardal|larvik|lavagis|lavangen|leangaviika|lebesby|leikanger|leirfjord|leirvik|leka|leksvik|lenvik|lerdal|lesja|levanger|lier|lierne|lillehammer|lillesand|lindas|lindesnes|loabat|lodingen|lom|loppa|lorenskog|loten|lund|lunner|luroy|luster|lyngdal|lyngen|malatvuopmi|malselv|malvik|mandal|marker|marnardal|masfjorden|masoy|matta-varjjat|meland|meldal|melhus|meloy|meraker|midsund|midtre-gauldal|mil|mjondalen|mo-i-rana|moareke|modalen|modum|molde|mosjoen|moskenes|moss|mr|muosat|museum|naamesjevuemie|namdalseid|namsos|namsskogan|nannestad|naroy|narviika|narvik|naustdal|navuotna|nedre-eiker|nes.akershus|nes.buskerud|nesna|nesodden|nesoddtangen|nesseby|nesset|nissedal|nittedal|nl|nord-aurdal|nord-fron|nord-odal|norddal|nordkapp|nordre-land|nordreisa|nore-og-uvdal|notodden|notteroy|nt|odda|of|oksnes|ol|omasvuotna|oppdal|oppegard|orkanger|orkdal|orland|orskog|orsta|os.hedmark|os.hordaland|osen|oslo|osoyro|osteroy|ostre-toten|overhalla|ovre-eiker|oyer|oygarden|oystre-slidre|porsanger|porsangu|porsgrunn|priv|rade|radoy|rahkkeravju|raholt|raisa|rakkestad|ralingen|rana|randaberg|rauma|re|rendalen|rennebu|rennesoy|rindal|ringebu|ringerike|ringsaker|risor|rissa|rl|roan|rodoy|rollag|romsa|romskog|roros|rost|royken|royrvik|ruovat|rygge|salangen|salat|saltdal|samnanger|sande.more-og-romsdal|sande.vestfold|sande.xn--mre-og-romsdal-qqb|sandefjord|sandnes|sandnessjoen|sandoy|sarpsborg|sauda|sauherad|sel|selbu|selje|seljord|sf|siellak|sigdal|siljan|sirdal|skanit|skanland|skaun|skedsmo|skedsmokorset|ski|skien|skierva|skiptvet|skjak|skjervoy|skodje|slattum|smola|snaase|snasa|snillfjord|snoasa|sogndal|sogne|sokndal|sola|solund|somna|sondre-land|songdalen|sor-aurdal|sor-fron|sor-odal|sor-varanger|sorfold|sorreisa|sortland|sorum|spjelkavik|spydeberg|st|stange|stat|stathelle|stavanger|stavern|steigen|steinkjer|stjordal|stjordalshalsen|stokke|stor-elvdal|stord|stordal|storfjord|strand|stranda|stryn|sula|suldal|sund|sunndal|suohkan|surnadal|svalbard|sveio|svelvik|sykkylven|tana|tananger|time|tingvoll|tinn|tjeldsund|tjielte|tjome|tm|tokke|tolga|tonsberg|torsken|tr|trana|tranby|tranoy|troandin|trogstad|tromsa|tromso|trondheim|trysil|tvedestrand|tydal|tynset|tysfjord|tysnes|tysvar|uenorge|ullensaker|ullensvang|ulstein|ulvik|unjarga|utsira|va|vaapste|vadso|vaga|vagan|vagsoy|vaksdal|valer.hedmark|valer.ostfold|valle|vang|vanylven|vardo|varggat|varoy|vefsn|vega|vegarshei|vennesla|verdal|verran|vestby|vestnes|vestre-slidre|vestre-toten|vestvagoy|vevelstad|vf|vgs|vik|vikna|vindafjord|voagat|volda|voss|vossevangen|xn--andy-ira|xn--asky-ira|xn--aurskog-hland-jnb|xn--avery-yua|xn--b-5ga.nordland|xn--b-5ga.telemark|xn--bdddj-mrabd|xn--bearalvhki-y4a|xn--berlevg-jxa|xn--bhcavuotna-s4a|xn--bhccavuotna-k7a|xn--bidr-5nac|xn--bievt-0qa|xn--bjddar-pta|xn--blt-elab|xn--bmlo-gra|xn--bod-2na|xn--brnny-wuac|xn--brnnysund-m8ac|xn--brum-voa|xn--btsfjord-9za|xn--davvenjrga-y4a|xn--dnna-gra|xn--drbak-wua|xn--dyry-ira|xn--eveni-0qa01ga|xn--finny-yua|xn--fjord-lra|xn--fl-zia|xn--flor-jra|xn--frde-gra|xn--frna-woa|xn--frya-hra|xn--ggaviika-8ya47h|xn--gildeskl-g0a|xn--givuotna-8ya|xn--gjvik-wua|xn--gls-elac|xn--h-2fa|xn--hamary-fya|xn--hbmer-xqa|xn--hcesuolo-7ya35b|xn--hery-ira.nordland|xn--hery-ira.xn--mre-og-romsdal-qqb|xn--hgebostad-g3a|xn--hmmrfeasta-s4ac|xn--hnefoss-q1a|xn--hobl-ira|xn--holtlen-hxa|xn--hpmir-xqa|xn--hyanger-q1a|xn--hylandet-54a|xn--indery-fya|xn--jlster-bya|xn--jrpeland-54a|xn--karlsy-fya|xn--karmy-yua|xn--kfjord-iua|xn--klbu-woa|xn--koluokta-7ya57h|xn--krager-gya|xn--kranghke-b0a|xn--krdsherad-m8a|xn--krehamn-dxa|xn--krjohka-hwab49j|xn--ksnes-uua|xn--kvfjord-nxa|xn--kvitsy-fya|xn--kvnangen-k0a|xn--l-1fa|xn--laheadju-7ya|xn--langevg-jxa|xn--ldingen-q1a|xn--leagaviika-52b|xn--lesund-hua|xn--lgrd-poac|xn--lhppi-xqa|xn--linds-pra|xn--loabt-0qa|xn--lrdal-sra|xn--lrenskog-54a|xn--lt-liac|xn--lten-gra|xn--lury-ira|xn--mely-ira|xn--merker-kua|xn--mjndalen-64a|xn--mlatvuopmi-s4a|xn--mli-tla|xn--mlselv-iua|xn--moreke-jua|xn--mosjen-eya|xn--mot-tla|xn--msy-ula0h|xn--mtta-vrjjat-k7af|xn--muost-0qa|xn--nmesjevuemie-tcba|xn--nry-yla5g|xn--nttery-byae|xn--nvuotna-hwa|xn--oppegrd-ixa|xn--ostery-fya|xn--osyro-wua|xn--porsgu-sta26f|xn--rady-ira|xn--rdal-poa|xn--rde-ula|xn--rdy-0nab|xn--rennesy-v1a|xn--rhkkervju-01af|xn--rholt-mra|xn--risa-5na|xn--risr-ira|xn--rland-uua|xn--rlingen-mxa|xn--rmskog-bya|xn--rros-gra|xn--rskog-uua|xn--rst-0na|xn--rsta-fra|xn--ryken-vua|xn--ryrvik-bya|xn--s-1fa|xn--sandnessjen-ogb|xn--sandy-yua|xn--seral-lra|xn--sgne-gra|xn--skierv-uta|xn--skjervy-v1a|xn--skjk-soa|xn--sknit-yqa|xn--sknland-fxa|xn--slat-5na|xn--slt-elab|xn--smla-hra|xn--smna-gra|xn--snase-nra|xn--sndre-land-0cb|xn--snes-poa|xn--snsa-roa|xn--sr-aurdal-l8a|xn--sr-fron-q1a|xn--sr-odal-q1a|xn--sr-varanger-ggb|xn--srfold-bya|xn--srreisa-q1a|xn--srum-gra|xn--stjrdal-s1a|xn--stjrdalshalsen-sqb|xn--stre-toten-zcb|xn--tjme-hra|xn--tnsberg-q1a|xn--trany-yua|xn--trgstad-r1a|xn--trna-woa|xn--troms-zua|xn--tysvr-vra|xn--unjrga-rta|xn--vads-jra|xn--vard-jra|xn--vegrshei-c0a|xn--vestvgy-ixa6o|xn--vg-yiab|xn--vgan-qoa|xn--vgsy-qoa0j|xn--vler-qoa.hedmark|xn--vler-qoa.xn--stfold-9xa|xn--vre-eiker-k8a|xn--vrggt-xqad|xn--vry-yla5g|xn--yer-zna|xn--ygarden-p1a|xn--ystre-slidre-ujb",
  "np": "*",
  "nr": "biz|com|edu|gov|info|net|org",
  "nz": "ac|co|cri|geek|gen|govt|health|iwi|kiwi|maori|mil|net|org|parliament|school|xn--mori-qsa",
  "om": "co|com|edu|gov|med|museum|net|org|pro",
  "pa": "abo|ac|com|edu|gob|ing|med|net|nom|org|sld",
  "pe": "com|edu|gob|mil|net|nom|org",
  "pf": "com|edu|org",
  "pg": "*",
  "ph": "com|edu|gov|i|mil|net|ngo|org",
  "pk": "ac|biz|com|edu|fam|gkp|gob|gog|gok|gop|gos|gov|net|org|web",
  "pl": "agro|aid|ap.gov|atm|augustow|auto|babia-gora|bedzin|beskidy|bialowieza|bialystok|bielawa|bieszczady|biz|boleslawiec|bydgoszcz|bytom|cieszyn|com|czeladz|czest|dlugoleka|edu|elblag|elk|glogow|gmina|gniezno|gorlice|gov|grajewo|griw.gov|gsm|ic.gov|ilawa|info|is.gov|jaworzno|jelenia-gora|jgora|kalisz|karpacz|kartuzy|kaszuby|katowice|kazimierz-dolny|kepno|ketrzyn|klodzko|kmpsp.gov|kobierzyce|kolobrzeg|konin|konskowola|konsulat.gov|kppsp.gov|kutno|kwp.gov|kwpsp.gov|lapy|lebork|legnica|lezajsk|limanowa|lomza|lowicz|lubin|lukow|mail|malbork|malopolska|mazowsze|mazury|media|miasta|mielec|mielno|mil|mragowo|mup.gov|mw.gov|naklo|net|nieruchomosci|nom|nowaruda|nysa|oia.gov|oirm.gov|oke.gov|olawa|olecko|olkusz|olsztyn|oow.gov|opoczno|opole|org|oschr.gov|ostroda|ostroleka|ostrowiec|ostrowwlkp|oum.gov|pa.gov|pc|pila|pinb.gov|pisz|piw.gov|po.gov|podhale|podlasie|polkowice|pomorskie|pomorze|powiat|pr.gov|priv|prochowice|pruszkow|przeworsk|psp.gov|psse.gov|pulawy|pup.gov|radom|rawa-maz|realestate|rel|rybnik|rzeszow|rzgw.gov|sa.gov|sanok|sdn.gov|sejny|sex|shop|sklep|sko.gov|skoczow|slask|slupsk|so.gov|sos|sosnowiec|sr.gov|stalowa-wola|starachowice|stargard|starostwo.gov|suwalki|swidnica|swiebodzin|swinoujscie|szczecin|szczytno|szkola|targi|tarnobrzeg|tgory|tm|tourism|travel|turek|turystyka|tychy|ug.gov|ugim.gov|um.gov|umig.gov|upow.gov|uppo.gov|us.gov|ustka|uw.gov|uzs.gov|walbrzych|warmia|warszawa|waw|wegrow|wielun|wif.gov|wiih.gov|winb.gov|wios.gov|witd.gov|wiw.gov|wkz.gov|wlocl|wloclawek|wodzislaw|wolomin|wroclaw|wsa.gov|wskr.gov|wsse.gov|wuoz.gov|wzmiuw.gov|zachpomor|zagan|zarow|zgora|zgorzelec|zp.gov|zpisdn.gov",
  "pn": "co|edu|gov|net|org",
  "pr": "ac|biz|com|edu|est|gov|info|isla|name|net|org|pro|prof",
  "pro": "aaa|aca|acct|avocat|bar|cpa|eng|jur|law|med|recht",
  "ps": "com|edu|gov|net|org|plo|sec",
  "pt": "com|edu|gov|int|net|nome|org|publ",
  "pw": "gov",
  "py": "com|coop|edu|gov|mil|net|org",
  "qa": "com|edu|gov|mil|name|net|org|sch",
  "re": "asso|com",
  "ro": "arts|com|firm|info|nom|nt|org|rec|store|tm|www",
  "rs": "ac|co|edu|gov|in|org",
  "rw": "ac|co|coop|gov|mil|net|org",
  "sa": "com|edu|gov|med|net|org|pub|sch",
  "sb": "com|edu|gov|net|org",
  "sc": "com|edu|gov|net|org",
  "sd": "com|edu|gov|info|med|net|org|tv",
  "se": "a|ac|b|bd|brand|c|d|e|f|fh|fhsk|fhv|g|h|i|k|komforb|kommunalforbund|komvux|l|lanbib|m|n|naturbruksgymn|o|org|p|parti|pp|press|r|s|t|tm|u|w|x|y|z",
  "sg": "com|edu|gov|net|org",
  "sh": "com|gov|mil|net|org",
  "sk": "org",
  "sl": "com|edu|gov|net|org",
  "sn": "art|com|edu|gouv|org|univ",
  "so": "com|edu|gov|me|net|org",
  "ss": "biz|co|com|edu|gov|me|net|org|sch",
  "st": "co|com|consulado|edu|embaixada|mil|net|org|principe|saotome|store",
  "sv": "com|edu|gob|org|red",
  "sx": "gov",
  "sy": "com|edu|gov|mil|net|org",
  "sz": "ac|co|org",
  "th": "ac|co|go|in|mi|net|or",
  "tj": "biz|co|com|edu|go|gov|int|mil|name|net|nic|org|test|web",
  "tl": "gov",
  "tm": "co|com|edu|gov|mil|net|nom|org",
  "tn": "com|ens|fin|gov|ind|info|intl|mincom|nat|net|org|perso|tourism",
  "to": "com|edu|gov|mil|net|org",
  "tr": "av|bbs|bel|biz|com|dr|edu|gen|gov.nc|gov|info|k12|kep|mil|name|nc|net|org|pol|tel|tsk|tv|web",
  "tt": "biz|co|com|edu|gov|info|mil|name|net|org|pro",
  "tw": "club|com|ebiz|edu|game|gov|idv|mil|net|org",
  "tz": "ac|co|go|hotel|info|me|mil|mobi|ne|or|sc|tv",
  "ua": "cherkassy|cherkasy|chernigov|chernihiv|chernivtsi|chernovtsy|ck|cn|com|cr|crimea|cv|dn|dnepropetrovsk|dnipropetrovsk|donetsk|dp|edu|gov|if|in|ivano-frankivsk|kh|kharkiv|kharkov|kherson|khmelnitskiy|khmelnytskyi|kiev|kirovograd|km|kr|kropyvnytskyi|krym|ks|kv|kyiv|lg|lt|lugansk|luhansk|lutsk|lv|lviv|mk|mykolaiv|net|nikolaev|od|odesa|odessa|org|pl|poltava|rivne|rovno|rv|sb|sebastopol|sevastopol|sm|sumy|te|ternopil|uz|uzhgorod|uzhhorod|vinnica|vinnytsia|vn|volyn|yalta|zakarpattia|zaporizhzhe|zaporizhzhia|zhitomir|zhytomyr|zp|zt",
  "ug": "ac|co|com|edu|go|gov|mil|ne|or|org|sc|us",
  "uk": "*.sch|ac|co|gov|ltd|me|net|nhs|org|plc|police",
  "us": "ak|al|ann-arbor.mi|ar|as|az|ca|cc.ak|cc.al|cc.ar|cc.as|cc.az|cc.ca|cc.co|cc.ct|cc.dc|cc.de|cc.fl|cc.ga|cc.gu|cc.hi|cc.ia|cc.id|cc.il|cc.in|cc.ks|cc.ky|cc.la|cc.ma|cc.md|cc.me|cc.mi|cc.mn|cc.mo|cc.ms|cc.mt|cc.nc|cc.ne|cc.nh|cc.nj|cc.nm|cc.nv|cc.ny|cc.oh|cc.ok|cc.or|cc.pa|cc.pr|cc.ri|cc.sc|cc.sd|cc.tn|cc.tx|cc.ut|cc.va|cc.vi|cc.vt|cc.wa|cc.wi|cc.wv|cc.wy|chtr.k12.ma|co|cog.mi|ct|dc|de|dni|dst.mi|eaton.mi|fl|ga|gen.mi|gu|hi|ia|id|il|in|isa|k12.ak|k12.al|k12.ar|k12.as|k12.az|k12.ca|k12.co|k12.ct|k12.dc|k12.fl|k12.ga|k12.gu|k12.ia|k12.id|k12.il|k12.in|k12.ks|k12.ky|k12.la|k12.ma|k12.md|k12.me|k12.mi|k12.mn|k12.mo|k12.ms|k12.mt|k12.nc|k12.ne|k12.nh|k12.nj|k12.nm|k12.nv|k12.ny|k12.oh|k12.ok|k12.or|k12.pa|k12.pr|k12.sc|k12.tn|k12.tx|k12.ut|k12.va|k12.vi|k12.vt|k12.wa|k12.wi|k12.wy|ks|ky|la|lib.ak|lib.al|lib.ar|lib.as|lib.az|lib.ca|lib.co|lib.ct|lib.dc|lib.fl|lib.ga|lib.gu|lib.hi|lib.ia|lib.id|lib.il|lib.in|lib.ks|lib.ky|lib.la|lib.ma|lib.md|lib.me|lib.mi|lib.mn|lib.mo|lib.mt|lib.nc|lib.ne|lib.nh|lib.nj|lib.nm|lib.nv|lib.ny|lib.oh|lib.ok|lib.or|lib.pa|lib.pr|lib.ri|lib.sc|lib.sd|lib.tn|lib.tx|lib.ut|lib.va|lib.vi|lib.vt|lib.wa|lib.wi|lib.wy|ma|md|me|mi|mn|mo|ms|mt|mus.mi|nc|nd|ne|nh|nj|nm|nsn|nv|ny|oh|ok|or|pa|paroch.k12.ma|pr|pvt.k12.ma|ri|sc|sd|tec.mi|tn|tx|ut|va|vi|vt|wa|washtenaw.mi|wi|wv|wy",
  "uy": "com|edu|gub|mil|net|org",
  "uz": "co|com|net|org",
  "vc": "com|edu|gov|mil|net|org",
  "ve": "arts|bib|co|com|e12|edu|emprende|firm|gob|gov|ia|info|int|mil|net|nom|org|rar|rec|store|tec|web",
  "vg": "edu",
  "vi": "co|com|k12|net|org",
  "vn": "ac|ai|angiang|bacgiang|backan|baclieu|bacninh|baria-vungtau|bentre|binhdinh|binhduong|binhphuoc|binhthuan|biz|camau|cantho|caobang|com|daklak|daknong|danang|dienbien|dongnai|dongthap|edu|gialai|gov|hagiang|haiduong|haiphong|hanam|hanoi|hatinh|haugiang|health|hoabinh|hue|hungyen|id|info|int|io|khanhhoa|kiengiang|kontum|laichau|lamdong|langson|laocai|longan|namdinh|name|net|nghean|ninhbinh|ninhthuan|org|phutho|phuyen|pro|quangbinh|quangnam|quangngai|quangninh|quangtri|soctrang|sonla|tayninh|thaibinh|thainguyen|thanhhoa|thanhphohochiminh|thuathienhue|tiengiang|travinh|tuyenquang|vinhlong|vinhphuc|yenbai",
  "vu": "com|edu|net|org",
  "ws": "com|edu|gov|net|org",
  "xn--4dbrk0ce": "xn--4dbgdty6c|xn--5dbhl8d|xn--8dbq2a|xn--hebda8b",
  "xn--90a3ac": "xn--80au|xn--90azh|xn--c1avg|xn--d1at|xn--o1ac|xn--o1ach",
  "xn--j6w193g": "xn--55qx5d|xn--gmqw5a|xn--mxtq1m|xn--od0alg|xn--uc0atv|xn--wcvs22d",
  "xn--o3cw4h": "xn--12c1fe0br|xn--12cfi8ixb8l|xn--12co0c3b4eva|xn--h3cuzk1di|xn--m3ch0j3a|xn--o3cyx2a",
  "ye": "com|edu|gov|mil|net|org",
  "za": "ac|agric|alt|co|edu|gov|grondar|law|mil|net|ngo|nic|nis|nom|org|school|tm|web",
  "zm": "ac|biz|co|com|edu|gov|info|mil|net|org|sch",
  "zw": "ac|co|gov|mil|org",
});
/* END GENERATED ICANN PSL */

const wardenOneIcannCache = new Map();
function wardenOneIcannSuffix(host) {
  const labels = host.split('.');
  const tld = labels[labels.length - 1];
  if (!Object.prototype.hasOwnProperty.call(WARDENONE_ICANN_GROUPS, tld)) return tld;
  let rules = wardenOneIcannCache.get(tld);
  if (!rules) {
    rules = new Set(WARDENONE_ICANN_GROUPS[tld].split('|'));
    wardenOneIcannCache.set(tld, rules);
  }
  for (let i = 0; i < labels.length - 1; i++) {
    if (rules.has('!' + labels.slice(i, -1).join('.'))) return labels.slice(i + 1).join('.');
  }
  for (let i = 0; i < labels.length - 1; i++) {
    const plain = labels.slice(i, -1).join('.');
    const tail = labels.slice(i + 1, -1).join('.');
    if (rules.has(plain) || rules.has(tail ? '*.' + tail : '*')) return labels.slice(i).join('.');
  }
  return tld;
}

const WARDENONE_PRIVATE_SUFFIXES = Object.freeze([
  'appspot.com', 'azurewebsites.net', 'blogspot.com', 'firebaseapp.com', 'fly.dev',
  'github.io', 'gitlab.io', 'glitch.me', 'herokuapp.com', 'myshopify.com',
  'netlify.app', 'notion.site', 'onrender.com', 'pages.dev', 'railway.app',
  'readthedocs.io', 'repl.co', 'replit.app', 'surge.sh', 'tumblr.com',
  'vercel.app', 'vercel.sh', 'web.app', 'wixsite.com', 'workers.dev', 'wordpress.com',
]);

/* These providers have service-specific labels between the customer and the public
 * suffix (bucket.s3.region.amazonaws.com, account.blob.core.windows.net, and so on).
 * Guessing which label owns which would merge customers again. Exact-host identity is
 * conservative, compatible with host-scoped controls, and never widens trust. */
const WARDENONE_OPAQUE_TENANT_SUFFIXES = Object.freeze([
  'amazonaws.com', 'blob.core.windows.net', 'cloudfront.net', 'googleusercontent.com',
  'storage.googleapis.com',
]);

function regDomain(host) {
  let value = String(host || '').trim().toLowerCase().replace(/\.+$/, '');
  try {
    if (/^[a-z][a-z0-9+.-]*:\/\//i.test(value)) value = new URL(value).hostname.toLowerCase();
  } catch (_) {}
  if (value[0] !== '[' && (value.match(/:/g) || []).length === 1) value = value.replace(/:\d+$/, '');
  try { if (/[^\x00-\x7f]/.test(value)) value = new URL('http://' + value).hostname; } catch (_) {}
  value = value.replace(/\.+$/, '');
  const bare = value.replace(/^www\./, '');
  // www.ck is a PSL exception; stripping www from a suffix can change its owner.
  return bare !== value && bare === wardenOneIcannSuffix(bare) ? value : bare;
}

function wardenOneSuffixMatch(host, suffixes) {
  const h = regDomain(host);
  let found = '';
  for (const suffix of suffixes) {
    if ((h === suffix || h.endsWith('.' + suffix)) && suffix.length > found.length) found = suffix;
  }
  return found;
}

function sharedTenantSuffix(host) {
  return wardenOneSuffixMatch(host, WARDENONE_PRIVATE_SUFFIXES)
    || wardenOneSuffixMatch(host, WARDENONE_OPAQUE_TENANT_SUFFIXES);
}

function isSharedTenantHost(host) {
  const h = regDomain(host);
  const suffix = sharedTenantSuffix(h);
  return !!(suffix && h !== suffix);
}

function registrableDomain(host) {
  const h = regDomain(host);
  if (!h || h === 'localhost' || /^\d{1,3}(?:\.\d{1,3}){3}$/.test(h) || h.includes(':')) return h;
  const opaque = wardenOneSuffixMatch(h, WARDENONE_OPAQUE_TENANT_SUFFIXES);
  if (opaque) return h;
  const privateSuffix = wardenOneSuffixMatch(h, WARDENONE_PRIVATE_SUFFIXES);
  if (privateSuffix) {
    if (h === privateSuffix) return h;
    const hostParts = h.split('.');
    const suffixParts = privateSuffix.split('.');
    return hostParts.slice(-(suffixParts.length + 1)).join('.');
  }
  const suffix = wardenOneIcannSuffix(h);
  return h === suffix ? h : h.split('.').slice(-(suffix.split('.').length + 1)).join('.');
}

function sameSiteDomain(a, b) {
  const left = registrableDomain(a);
  const right = registrableDomain(b);
  return !!(left && right && left === right);
}

/* Full private rules remain worker-only (SEC-07). Frames receive their own site in
 * the worker config; until then, the curated tenant floor still separates known platforms. */
let __wardenOnePslIndex = null;
let __wardenOneFullPslIndex = null;
function wardenOnePslIndex(includeIcann = false) {
  const cached = includeIcann ? __wardenOneFullPslIndex : __wardenOnePslIndex;
  if (cached) return cached;
  const plain = new Set();
  const wildcard = new Set();
  const exception = new Set();
  let raw = '';
  try { if (typeof WARDENONE_PSL_PRIVATE_RULES === 'string') raw = WARDENONE_PSL_PRIVATE_RULES; } catch (_) { raw = ''; }
  if (includeIcann && typeof WARDENONE_PSL_ICANN_RULES === 'string') raw += '\n' + WARDENONE_PSL_ICANN_RULES;
  for (const rule of raw.split('\n')) {
    if (!rule) continue;
    if (rule[0] === '!') exception.add(rule.slice(1));
    else if (rule.startsWith('*.')) wildcard.add(rule.slice(2));
    else plain.add(rule);
  }
  const index = { plain, wildcard, exception, loaded: raw.length > 0 };
  if (includeIcann) __wardenOneFullPslIndex = index;
  else __wardenOnePslIndex = index;
  return index;
}

/* The public suffix of a host under the private rules, by the list's own algorithm: an exception
 * rule wins outright and names the suffix minus its first label; otherwise the rule with the most
 * labels wins, a wildcard standing for exactly one label. '' when no private rule matches. */
function wardenOnePslSuffix(host, includeIcann = false) {
  const index = wardenOnePslIndex(includeIcann);
  if (!index.loaded) return '';
  const labels = String(host || '').split('.');
  for (let i = 0; i < labels.length; i++) {
    if (index.exception.has(labels.slice(i).join('.'))) return labels.slice(i + 1).join('.');
  }
  let best = '';
  for (let i = 0; i < labels.length; i++) {
    const candidate = labels.slice(i).join('.');
    if (candidate.length <= best.length) break;   // shorter than what is already found
    if (index.plain.has(candidate) || (i + 1 < labels.length && index.wildcard.has(labels.slice(i + 1).join('.')))) best = candidate;
  }
  return best;
}

/* registrableDomain with the complete private list, for trust decisions: "are these two hosts one
 * owner". The answer is never broader than registrableDomain's -- a private rule can only push the
 * boundary further right, and the longer of the two is taken regardless -- so switching a check to
 * this can withdraw trust between two tenants and can never grant it. Lookups keyed by the
 * registered domain (WHOIS, breach records, list membership) keep registrableDomain: alice.webflow.io
 * is a site, but webflow.io is the domain somebody registered. */
function siteIdentity(host) {
  const h = regDomain(host);
  const loose = registrableDomain(h);
  if (!h || loose === h) return loose;
  const suffix = wardenOnePslSuffix(h);
  if (!suffix) return loose;
  if (suffix === h) return h;   // the host is itself a platform suffix: its own identity, as github.io is
  const strict = h.split('.').slice(-(suffix.split('.').length + 1)).join('.');
  return strict.length > loose.length ? strict : loose;
}

function sameSiteIdentity(a, b) {
  const left = siteIdentity(a);
  const right = siteIdentity(b);
  return !!(left && right && left === right);
}

/* Directional host-list matching. Ordinary entries cover their subdomains, as
 * users expect. A private platform apex (github.io) covers only itself rather
 * than every tenant, and opaque infrastructure entries are exact-host only. */
function hostMatchesSite(host, candidate) {
  const h = regDomain(host);
  const d = regDomain(candidate);
  if (!h || !d) return false;
  if (d === wardenOneIcannSuffix(d)) return h === d;
  const opaque = wardenOneSuffixMatch(h, WARDENONE_OPAQUE_TENANT_SUFFIXES)
    || wardenOneSuffixMatch(d, WARDENONE_OPAQUE_TENANT_SUFFIXES);
  if (opaque) return h === d;
  const privateSuffix = wardenOneSuffixMatch(h, WARDENONE_PRIVATE_SUFFIXES)
    || wardenOneSuffixMatch(d, WARDENONE_PRIVATE_SUFFIXES);
  if (privateSuffix && d === privateSuffix) return h === d;
  return h === d || (h.endsWith('.' + d) && sameSiteIdentity(h, d));
}
