'use client';

import { CheckCircle2, ChevronRight, Mic, Phone, Smile, Video, MoreVertical } from 'lucide-react';

interface WhatsAppPreviewProps {
  businessName?: string;
  templateName?: string;
  templateCategory?: 'MARKETING' | 'UTILITY' | 'AUTHENTICATION';
  headerMediaUrl?: string;
  headerText?: string;
  bodyText?: string;
  footerText?: string;
  buttons?: Array<{ text: string; type?: string }>;
  customerReplyText?: string;
  showCustomerReply?: boolean;
}

export function WhatsAppPreview({
  businessName = 'Your Store',
  templateName = 'festive_offer',
  templateCategory = 'MARKETING',
  headerMediaUrl,
  headerText,
  bodyText = 'Hi Priya! Our festive sale is live.\nGet 40% off, this weekend only.\nReply STOP to unsubscribe',
  footerText,
  buttons = [
    { text: 'Shop the sale' },
    { text: 'View catalogue' },
  ],
  customerReplyText = 'Do you have it in blue?',
  showCustomerReply = true,
}: WhatsAppPreviewProps) {
  return (
    <div className="relative mx-auto w-full max-w-[340px] rounded-[42px] border-[10px] border-zinc-900 bg-zinc-950 p-1.5 shadow-2xl ring-1 ring-zinc-800">
      {/* Phone speaker / camera notch */}
      <div className="relative h-6 w-full flex items-center justify-between px-6 pt-1 text-[11px] font-semibold text-zinc-300">
        <span>9:41</span>
        <div className="absolute left-1/2 top-2 h-4 w-24 -translate-x-1/2 rounded-full bg-zinc-900" />
        <div className="flex items-center gap-1.5">
          <span className="inline-block h-2 w-2 rounded-full bg-zinc-300" />
          <span className="text-[10px]">100%</span>
        </div>
      </div>

      {/* Screen container */}
      <div className="overflow-hidden rounded-[32px] bg-[#0b141a] text-zinc-100 flex flex-col min-h-[560px]">
        {/* WhatsApp App Header */}
        <div className="flex items-center justify-between bg-[#1f2c34] px-3 py-2.5 border-b border-zinc-800 text-white">
          <div className="flex items-center gap-2 min-w-0">
            <div className="relative flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-emerald-600 text-xs font-bold text-white shadow">
              {businessName.slice(0, 1).toUpperCase()}
              <span className="absolute -bottom-0.5 -right-0.5 flex h-3.5 w-3.5 items-center justify-center rounded-full bg-white text-emerald-600">
                <CheckCircle2 className="h-3 w-3 fill-emerald-500 text-white" />
              </span>
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-1">
                <h4 className="truncate text-xs font-semibold leading-tight">{businessName}</h4>
              </div>
              <p className="text-[10px] text-emerald-400 font-medium">Business account</p>
            </div>
          </div>
          <div className="flex items-center gap-3 text-zinc-300">
            <Video className="h-4 w-4" />
            <Phone className="h-3.5 w-3.5" />
            <MoreVertical className="h-4 w-4" />
          </div>
        </div>

        {/* WhatsApp Chat Wallpaper & Message Area */}
        <div className="relative flex-1 p-3 space-y-3 bg-[#0b141a] bg-opacity-95 overflow-y-auto">
          {/* Subtle background pattern overlay */}
          <div className="pointer-events-none absolute inset-0 opacity-5 [background-image:radial-gradient(#25d366_1px,transparent_1px)] [background-size:16px_16px]" />

          {/* Timestamp chip */}
          <div className="flex justify-center">
            <span className="rounded-md bg-[#182229] px-2 py-0.5 text-[9px] font-medium text-zinc-400 shadow-sm uppercase tracking-wider">
              Today
            </span>
          </div>

          {/* Business Message Bubble */}
          <div className="relative max-w-[88%] rounded-2xl rounded-tl-sm bg-[#202c33] p-1 text-zinc-100 shadow-md">
            {/* Header Media / Banner if present */}
            {headerMediaUrl ? (
              <div className="overflow-hidden rounded-xl">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={headerMediaUrl} alt="Template header" className="h-32 w-full object-cover" />
              </div>
            ) : headerText ? (
              <div className="rounded-xl bg-gradient-to-br from-zinc-800 to-zinc-900 p-4 text-center">
                <p className="text-sm font-bold text-white tracking-wide">{headerText}</p>
                {templateCategory === 'MARKETING' && (
                  <span className="mt-1 inline-block rounded bg-amber-500/20 px-2 py-0.5 text-[10px] font-semibold text-amber-300">
                    SPECIAL OFFER
                  </span>
                )}
              </div>
            ) : null}

            {/* Message Body */}
            <div className="p-2.5 pb-1">
              <p className="text-xs leading-relaxed whitespace-pre-wrap text-zinc-100">
                {bodyText}
              </p>
              {footerText && (
                <p className="mt-1.5 text-[10px] text-zinc-400">
                  {footerText}
                </p>
              )}
              <div className="mt-1 flex justify-end items-center gap-1 text-[9px] text-zinc-400">
                <span>10:00 AM</span>
              </div>
            </div>

            {/* Quick Reply / CTA Buttons */}
            {buttons && buttons.length > 0 && (
              <div className="mt-1 divide-y divide-zinc-700/60 border-t border-zinc-700/60">
                {buttons.map((btn, idx) => (
                  <div
                    key={idx}
                    className="flex items-center justify-center gap-1.5 py-2 text-xs font-medium text-[#53bdeb] hover:bg-zinc-700/30 transition-colors cursor-pointer"
                  >
                    <span>{btn.text}</span>
                    <ChevronRight className="h-3 w-3 opacity-60" />
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Customer Reply Bubble (to show conversational engagement) */}
          {showCustomerReply && customerReplyText && (
            <div className="flex justify-end">
              <div className="relative max-w-[80%] rounded-2xl rounded-tr-sm bg-[#005c4b] p-2 text-xs text-white shadow-md">
                <p className="leading-snug">{customerReplyText}</p>
                <div className="mt-1 flex items-center justify-end gap-1 text-[9px] text-emerald-200/80">
                  <span>10:02 AM</span>
                  <span className="text-emerald-300 font-bold">✓✓</span>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* WhatsApp Bottom Chat Input Bar */}
        <div className="flex items-center gap-1.5 bg-[#1f2c34] p-2 border-t border-zinc-800">
          <button type="button" aria-label="Emoji picker" className="p-1 text-zinc-400 hover:text-zinc-200">
            <Smile className="h-5 w-5" />
          </button>
          <div className="flex-1 rounded-full bg-[#2a3942] px-3.5 py-1.5 text-xs text-zinc-400">
            Message
          </div>
          <button type="button" aria-label="Voice message" className="flex h-8 w-8 items-center justify-center rounded-full bg-[#00a884] text-white shadow hover:bg-[#02906f]">
            <Mic className="h-4 w-4" />
          </button>
        </div>
      </div>
    </div>
  );
}
