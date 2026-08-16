# بحث مصادر القنوات القانونية لمشروع DZ HOOF

## مبدأ الاختيار

اشتراك IPTV شخصي مثل Lynx لا يثبت امتلاك حق إعادة توزيع القنوات للزبائن. لتوزيع القنوات عبر تطبيق DZ HOOF يجب الحصول على عقد يحدد بوضوح حقوق OTT/IPTV، المناطق المسموح بها، عدد المشتركين، إعادة البث، DRM، ووسيلة تسليم تقنية مثل HLS/DASH أو API/SDK.

## مصادر/منصات تم فحصها

### Amagi

صفحة Amagi الرسمية تعرض Linear Distribution عبر شبكات fiber/satellite/IP وشبكة شركاء عالمية، وتذكر القنوات الخطية وFAST والفعاليات الحية، مع طلب عرض تجاري. هذا يبدو حل توزيع وبنية للمحتوى وأصحاب الحقوق، وليس اشتراكًا جاهزًا يضمن لك قنوات عربية للزبائن.

URL: https://www.amagi.com/products/linear-distribution

### Wurl Global FAST Pass

Wurl تعرض إطلاق وتوزيع وتحقيق دخل لقنوات FAST، مع ingest وجدولة وتوزيع إلى أكثر من 65 منصة. الصفحة تذكر أنها مناسبة لأصحاب القنوات/المحتوى، وتطلب التواصل التجاري. هي خيار عندما نملك قنوات أو نتعاقد مع مالكيها، وليست بديلًا مباشرًا لاشتراك Lynx.

URL: https://www.wurl.com/solutions/global-fast-pass/

### Setplex

Setplex تعرض منصة white-label وإدارة مشغلي OTT وتطبيقات بعلامة تجارية، وميزات الاشتراكات والمحتوى والتسليم. يلزم التحقق التعاقدي من مصادر القنوات؛ المنصة التقنية وحدها لا تمنح حقوق بث قنوات الآخرين.

URL: https://setplex.com/resource-hub/white-label-ott-apps

## الاستنتاج المرحلي

الخيارات التجارية الجادة تقع في مسارين: شراء حقوق/feeds من مالكي القنوات أو موزع مرخص، ثم استخدام Backend وAndroid الخاصين بنا؛ أو التعاقد مع مزود OTT/FAST متكامل، مع التأكد كتابيًا أن الخطة تشمل حق إعادة التوزيع للعملاء في الجزائر. لا ينبغي اختيار مزود IPTV من قوائم عامة أو بناء القرار على السعر وعدد القنوات فقط.

## موزعون تجاريون في MENA

### Global Distribution Services

تذكر الصفحة الرسمية أن الشركة تعمل في ترخيص المحتوى في أفريقيا والشرق الأوسط، وتشمل محفظتها قنوات إنجليزية وفرنسية وتركية وعربية وبوليوود متاحة للترخيص عبر cable وIPTV وOTT والفنادق. هذا هو أقرب خيار وجدته لطلب عرض تجاري لقنوات جاهزة، مع ضرورة التأكد أن الجزائر وconsumer OTT وتطبيق Android مذكورة صراحة في العقد.

URL: https://www.globaldistributionservices.com/content-licensing

### SAWA Rights Management مع SES

إعلان SES الرسمي يذكر أن SAWA توزع قنوات مرخصة إلى منصات IPTV وOTT وcable وممتلكات تجارية في MENA، وتمتلك حقوقًا دولية لأكثر من 40 قناة وفق الإعلان. هذا خيار B2B يستحق التواصل، لكنه ليس اشتراكًا استهلاكيًا؛ يجب طلب عقد توزيع وfeeds وشروط المنطقة والعدد.

URL: https://www.ses.com/press-release/sawa-launches-new-commercial-video-distribution-platform-mena-ses

### ملاحظة عن Synamedia وAmagi وWurl

هذه أسماء قوية للبنية التحتية والتوزيع، لكنها لا تعني تلقائيًا أن العميل سيحصل على قنوات مملوكة للغير. Amagi تركز على linear distribution وشبكات التسليم، وWurl على إطلاق وتوزيع FAST، وSetplex على white-label OTT وإدارة المشتركين. كلها تحتاج اتفاقية تجارية وحقوق محتوى منفصلة.

## إضافات الاعتمادية التقنية

توثيق Apple الرسمي يوصي باستخدام `mediastreamvalidator` لمحاكاة جلسة HLS والتحقق من ملف index والـmedia segments، مع توليد تقرير تشخيصي قبل نشر stream أو alternate stream set. هذا يدعم إضافة فحص صحة HLS إلى Backend قبل إظهار القناة للزبون.

URL: https://developer.apple.com/documentation/http-live-streaming/deploying-a-basic-http-live-streaming-hls-stream

توثيق AWS Streaming Media Lens ظهر في البحث كمرجع لمراقبة صحة origin والتحويل إلى origin بديل، لكن فتح صفحة AWS محجوب في بيئة البحث الحالية؛ لذلك لم أعتمد على نصه في الاستنتاج النهائي.
