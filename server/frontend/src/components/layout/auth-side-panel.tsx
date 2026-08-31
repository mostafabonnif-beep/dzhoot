import { BrandMark } from './brand-mark';

const features = [
  {
    num: '01',
    title: 'إدارة المصادر والبث',
    desc: 'استورد M3U وXtream، نظّم القنوات، وراقب الحالة لحظيًا.',
  },
  {
    num: '02',
    title: 'ربط أجهزة التلفزيون',
    desc: 'اقتران آمن عبر PIN وQR لأجهزة Android TV وFire TV.',
  },
  {
    num: '03',
    title: 'دليل البرامج والمحتوى',
    desc: 'EPG وجدولة، مع أفلام ومسلسلات ضمن كتالوج موحّد.',
  },
  {
    num: '04',
    title: 'تشغيل محمي',
    desc: 'رموز تشغيل قصيرة العمر دون كشف بيانات اعتماد المصادر.',
  },
];

export function AuthSidePanel({ footer }: { footer: string }) {
  return (
    <div className="relative hidden lg:flex lg:w-[480px] flex-col justify-between overflow-hidden border-l border-white/10 bg-[#070b16] p-10 text-white">
      <div className="pointer-events-none absolute inset-0">
        <div className="absolute -right-24 -top-24 h-80 w-80 rounded-full bg-primary/25 blur-3xl" />
        <div className="absolute -left-16 top-40 h-64 w-64 rounded-full bg-cyan-400/10 blur-3xl" />
        <div className="absolute bottom-10 right-10 h-40 w-40 rounded-full bg-amber-500/10 blur-3xl" />
        <div className="absolute inset-0 opacity-[0.07] [background-image:linear-gradient(to_right,rgba(255,255,255,.35)_1px,transparent_1px),linear-gradient(to_bottom,rgba(255,255,255,.35)_1px,transparent_1px)] [background-size:42px_42px]" />
      </div>

      <div className="relative z-10">
        <BrandMark href="/" dark className="relative" />
        <div className="mt-10 max-w-sm">
          <p className="text-xs font-semibold uppercase tracking-[0.28em] text-primary">
            DZ HOOF Platform
          </p>
          <h2 className="mt-4 text-4xl font-display font-bold leading-[1.15]">
            لوحة تشغيل احترافية لمشروعك.
          </h2>
          <p className="mt-4 text-sm leading-7 text-white/65">
            منصة عربية لإدارة المصادر والأجهزة والمحتوى — مصممة للمشغّل الذي يملك حقوق البث.
          </p>
        </div>

        <div className="mt-10 grid grid-cols-3 gap-2">
          {[
            { k: 'M3U / Xtream', v: 'مصادر' },
            { k: 'Android TV', v: 'تطبيق' },
            { k: 'Self-Hosted', v: 'نشر' },
          ].map((item) => (
            <div
              key={item.k}
              className="rounded-2xl border border-white/10 bg-white/[0.04] px-3 py-3 text-center"
            >
              <p className="text-[11px] font-semibold text-white">{item.k}</p>
              <p className="mt-1 text-[10px] text-white/45">{item.v}</p>
            </div>
          ))}
        </div>

        <div className="mt-8 space-y-3">
          {features.map((f) => (
            <div
              key={f.num}
              className="group flex items-start gap-4 rounded-2xl border border-white/10 bg-white/[0.04] p-4 transition-all duration-200 hover:border-primary/30 hover:bg-white/[0.07]"
            >
              <div className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-primary/30 bg-primary/15 text-primary text-xs font-bold">
                {f.num}
              </div>
              <div>
                <p className="text-sm font-semibold text-white">{f.title}</p>
                <p className="mt-1 text-xs leading-6 text-white/55">{f.desc}</p>
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="relative z-10 rounded-2xl border border-white/10 bg-white/[0.04] p-4 text-xs leading-6 text-white/55">
        <span className="mb-2 block h-1 w-10 rounded-full bg-primary" />
        {footer}
      </div>
    </div>
  );
}
