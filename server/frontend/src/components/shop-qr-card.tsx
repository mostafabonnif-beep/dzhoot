'use client';

import { useEffect, useRef, useState } from 'react';
import QRCode from 'qrcode';
import { Printer } from 'lucide-react';
import Modal from '@/components/ui/modal';

interface ShopQrCardProps {
  reseller: { _id: string; name: string; phone?: string };
  open: boolean;
  onClose: () => void;
}

/**
 * Printable shop QR card: a customer scans the QR → lands on /buy?shop=<id>
 * where the shop's name + WhatsApp are preloaded, and orders directly from
 * that shop. Print opens a clean A6 card in a print dialog.
 */
export default function ShopQrCard({ reseller, open, onClose }: ShopQrCardProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [origin, setOrigin] = useState('');

  const url = `${origin}/buy?shop=${reseller._id}`;

  useEffect(() => {
    setOrigin(typeof window !== 'undefined' ? window.location.origin : '');
  }, []);

  useEffect(() => {
    if (open && canvasRef.current && origin) {
      QRCode.toCanvas(canvasRef.current, url, {
        width: 340,
        margin: 1,
        errorCorrectionLevel: 'M',
        color: { dark: '#1C1A24', light: '#FFFFFF' },
      }).catch((e) => console.error('[qr]', e));
    }
  }, [open, origin, url]);

  function handlePrint() {
    const iframe = document.createElement('iframe');
    iframe.style.position = 'fixed';
    iframe.style.right = '0';
    iframe.style.bottom = '0';
    iframe.style.width = '0';
    iframe.style.height = '0';
    iframe.style.border = '0';
    document.body.appendChild(iframe);
    const doc = iframe.contentDocument!;
    doc.write(`<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8">
      <title>بطاقة ${reseller.name}</title>
      <style>
        @page { size: 90mm 60mm; margin: 0; }
        body { margin: 0; display: flex; align-items: center; justify-content: center; min-height: 100vh; }
        .card { width: 82mm; height: 52mm; border: 1.5px solid #B85E10; border-radius: 4mm; padding: 3mm 4mm; display: flex; flex-direction: column; justify-content: space-between; box-sizing: border-box; }
        .head { display: flex; justify-content: space-between; align-items: center; }
        .brand { font-family: Arial, sans-serif; font-weight: 900; font-size: 15px; color: #B85E10; }
        .brand small { display: block; font-weight: 600; font-size: 9px; color: #5A5470; letter-spacing: 0.5px; }
        .mid { display: flex; align-items: center; gap: 4mm; }
        .qr { width: 34mm; height: 34mm; flex-shrink: 0; }
        .qr img { width: 100%; height: 100%; display: block; }
        .info { font-family: Arial, sans-serif; }
        .info .shop { font-size: 13px; font-weight: 800; color: #1C1A24; }
        .info .phone { font-size: 11px; color: #128C4A; direction: ltr; text-align: right; margin-top: 1mm; font-weight: 700; }
        .info .url { font-size: 7px; color: #5A5470; margin-top: 1.5mm; direction: ltr; text-align: right; word-break: break-all; }
        .foot { font-size: 8px; color: #5A5470; text-align: center; font-family: Arial, sans-serif; }
      </style></head><body>
      <div class="card">
        <div class="head">
          <div class="brand">DZ HOOF<small>التلفزيون الذكي بلا حدود</small></div>
          <div class="brand" style="text-align:left; color:#128C4A;">مسح واشترك</div>
        </div>
        <div class="mid">
          <div class="qr"><img src="${canvasRef.current?.toDataURL('image/png') || ''}" alt="QR" /></div>
          <div class="info">
            <div class="shop">${reseller.name}</div>
            <div class="phone">${reseller.phone ? `+${String(reseller.phone).replace(/\D/g, '')}` : ''}</div>
            <div class="url">${url}</div>
          </div>
        </div>
        <div class="foot">امسح الرمز، اختر باقتك، واطلب عبر واتساب — التفعيل فوري</div>
      </div>
      <script>window.onload = function(){ setTimeout(function(){ window.print(); }, 150); };</script>
      </body></html>`);
    doc.close();
    iframe.contentWindow!.onafterprint = () => iframe.remove();
  }

  return (
    <Modal open={open} onClose={onClose} title={`بطاقة محل — ${reseller.name}`}>
      <div className="space-y-4">
        <div className="flex flex-col items-center gap-3 rounded-2xl border border-border bg-white p-5">
          <div className="flex w-full items-center justify-between">
            <div>
              <div className="text-lg font-extrabold text-primary">DZ HOOF</div>
              <div className="text-xs text-muted-foreground">التلفزيون الذكي بلا حدود</div>
            </div>
            <span className="rounded-full bg-[#25D366]/10 px-3 py-1 text-xs font-bold text-[#128C4A]">
              مسح واشترك
            </span>
          </div>
          <canvas ref={canvasRef} className="rounded-lg" />
          <div className="w-full text-center">
            <div className="font-bold">{reseller.name}</div>
            {reseller.phone && (
              <div dir="ltr" className="text-sm font-semibold text-[#128C4A]">
                +{reseller.phone.replace(/\D/g, '')}
              </div>
            )}
            <div dir="ltr" className="mt-1 break-all text-[10px] text-muted-foreground">
              {url}
            </div>
          </div>
        </div>
        <p className="text-center text-xs text-muted-foreground">
          الزبون يمسح الرمز ← يفتح صفحة الاشتراك باسم محلك ← يطلب عبر واتسابك مباشرة.
        </p>
        <div className="flex items-center justify-center gap-2">
          <button
            onClick={handlePrint}
            className="inline-flex items-center gap-2 rounded-full bg-primary px-5 py-2 text-sm font-semibold text-primary-foreground transition hover:opacity-90"
          >
            <Printer className="h-4 w-4" aria-hidden="true" />
            طباعة البطاقة
          </button>
        </div>
      </div>
    </Modal>
  );
}
