import { BrandMark } from './brand-mark';

const features = [
  {
    num: '01',
    title: 'إدارة البث',
    desc: 'استورد القنوات المباشرة ونظّمها وراقب حالتها لحظيًا.',
  },
  {
    num: '02',
    title: 'ربط الأجهزة',
    desc: 'اربط الأجهزة المتصلة بشبكتك وأدرها بسهولة.',
  },
  {
    num: '03',
    title: 'دليل البرامج والجدولة',
    desc: 'وفّر دليل البرامج الإلكتروني وجدول المحتوى للمشاهدين.',
  },
];

export function AuthSidePanel({ footer }: { footer: string }) {
  return (
    <div className="relative hidden lg:flex lg:w-[460px] flex-col justify-between overflow-hidden border-l border-white/10 bg-[#0b1020] p-10 text-white">
      <div className="relative z-10">
        <div className="absolute -right-24 -top-24 h-72 w-72 rounded-full bg-primary/20 blur-3xl" />
        <div className="absolute -left-24 top-52 h-56 w-56 rounded-full bg-cyan-400/10 blur-3xl" />
        <BrandMark href="/" dark className="relative" />
        <div className="mt-10 max-w-sm">
          <p className="text-xs font-semibold uppercase tracking-[0.25em] text-primary">منصة بث ذكية</p>
          <h2 className="mt-4 text-4xl font-display font-bold leading-tight">كل قنواتك، في تجربة واحدة.</h2>
          <p className="mt-4 text-sm leading-7 text-white/60">إدارة المصادر والأجهزة والمحتوى من لوحة عربية واضحة صُممت لتكبر مع مشروعك.</p>
        </div>

        <div className="mt-10 space-y-3">
          {features.map((f) => (
            <div key={f.num} className="group flex items-start gap-4 rounded-2xl border border-white/10 bg-white/[0.04] p-4 transition-colors hover:bg-white/[0.08]">
              <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-xl border border-primary/30 bg-primary/15 text-primary text-xs font-bold">
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

      <div className="relative z-10 rounded-2xl border border-white/10 bg-white/[0.04] p-4 text-xs leading-6 text-white/55"><span className="mb-2 block h-1 w-10 rounded-full bg-primary" />{footer}</div>
    </div>
  );
}
