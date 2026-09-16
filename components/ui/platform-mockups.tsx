'use client';

import { useState } from 'react';

export interface Profile {
  displayName: string;
  avatarUrl: string | null;
  headline: string;
  twitterHandle: string;
  linkedinHandle: string | null;
}

export const FALLBACK_PROFILE: Profile = {
  displayName: 'Your Name',
  avatarUrl: null,
  headline: 'Your headline here',
  twitterHandle: 'yourhandle',
  linkedinHandle: null,
};

export function Avatar({ url, name, size, bg }: { url: string | null; name: string; size: number; bg: string }) {
  const initial = name.charAt(0).toUpperCase();
  if (url) {
    return (
      <img
        src={url}
        alt={name}
        width={size}
        height={size}
        className="rounded-full object-cover shrink-0 select-none"
        style={{ width: size, height: size }}
      />
    );
  }
  return (
    <div
      className={`rounded-full ${bg} flex items-center justify-center shrink-0 text-white font-bold select-none`}
      style={{ width: size, height: size, fontSize: size * 0.38 }}
    >
      {initial}
    </div>
  );
}

function formatCount(n: number): string {
  if (n >= 1000) return `${(n / 1000).toFixed(1)}K`;
  return String(n);
}

function TweetAction({ icon, count, hoverColor }: { icon: React.ReactNode; count: number; hoverColor: string }) {
  return (
    <div className="group flex cursor-pointer items-center gap-0.5">
      <div className="rounded-full p-1.5 group-hover:bg-[#1d1d1d]">
        <svg viewBox="0 0 24 24" className={`h-4 w-4 fill-[#71767b] ${hoverColor}`}>
          {icon}
        </svg>
      </div>
      {count > 0 && (
        <span className={`text-[13px] text-[#71767b] ${hoverColor}`}>
          {formatCount(count)}
        </span>
      )}
    </div>
  );
}

export function TwitterMockup({ text, profile }: { text: string; profile: Profile }) {
  return (
    <div className="rounded-xl overflow-hidden bg-black border border-[#2f3336]">
      <div className="px-3 py-2.5">
        <div className="flex gap-2.5">
          <div className="flex-shrink-0 pt-0.5">
            <Avatar url={profile.avatarUrl} name={profile.displayName} size={40} bg="bg-[#1D9BF0]" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1 text-[15px] leading-5">
              <span className="truncate font-bold text-[#e7e9ea]">{profile.displayName}</span>
              <span className="flex-shrink-0 text-[#71767b]">@{profile.twitterHandle}</span>
              <span className="flex-shrink-0 text-[#71767b]">&middot;</span>
              <span className="flex-shrink-0 text-[#71767b]">now</span>
            </div>
            <div className="mt-1 whitespace-pre-wrap text-[15px] leading-5 text-[#e7e9ea]">
              {text}
            </div>
            <div className="-ml-1.5 mt-2 flex justify-between">
              <TweetAction
                icon={<path d="M1.751 10c0-4.42 3.584-8 8.005-8h4.366c4.49 0 8.129 3.64 8.129 8.13 0 2.25-.862 4.394-2.427 6.014l-4.095 4.243c-.756.784-1.963.927-2.881.349l-.282-.183c-.603-.39-.988-1.059-.988-1.783v-2.37c0-.755-.304-1.478-.845-2.01l-.746-.748c-1.358-1.36-2.12-3.2-2.12-5.122V10z" />}
                count={24}
                hoverColor="group-hover:text-[#1d9bf0]"
              />
              <TweetAction
                icon={<path d="M4.5 3.88l4.432 4.14-1.364 1.46L5.5 7.55V16c0 1.1.896 2 2 2H13v2H7.5c-2.209 0-4-1.79-4-4V7.55L1.432 9.48.068 8.02 4.5 3.88zM16.5 6H11V4h5.5c2.209 0 4 1.79 4 4v8.45l2.068-1.93 1.364 1.46-4.432 4.14-4.432-4.14 1.364-1.46 2.068 1.93V8c0-1.1-.896-2-2-2z" />}
                count={47}
                hoverColor="group-hover:text-[#00ba7c]"
              />
              <TweetAction
                icon={<path d="M16.697 5.5c-1.222-.06-2.679.51-3.89 2.16l-.805 1.09-.806-1.09C9.984 6.01 8.526 5.44 7.304 5.5c-1.243.07-2.349.78-2.91 1.91-.552 1.12-.633 2.78.479 4.82 1.074 1.97 3.257 4.27 7.129 6.61 3.87-2.34 6.052-4.64 7.126-6.61 1.111-2.04 1.03-3.7.477-4.82-.561-1.13-1.666-1.84-2.908-1.91zm4.187 7.69c-1.351 2.48-4.001 5.12-8.379 7.67l-.503.3-.504-.3c-4.379-2.55-7.029-5.19-8.382-7.67-1.36-2.5-1.41-4.86-.514-6.67.887-1.79 2.647-2.91 4.601-3.01 1.651-.09 3.368.56 4.798 2.01 1.429-1.45 3.146-2.1 4.796-2.01 1.954.1 3.714 1.22 4.601 3.01.896 1.81.846 4.17-.514 6.67z" />}
                count={312}
                hoverColor="group-hover:text-[#f91880]"
              />
              <TweetAction
                icon={<path d="M8.75 21V3h2v18h-2zM18 21V8.5h2V21h-2zM4 21v-5.5h2V21H4z" />}
                count={18400}
                hoverColor="group-hover:text-[#1d9bf0]"
              />
              <TweetAction
                icon={<path d="M4 4.5C4 3.12 5.119 2 6.5 2h11C18.881 2 20 3.12 20 4.5v18.44l-8-5.71-8 5.71V4.5zM6.5 4c-.276 0-.5.22-.5.5v14.56l6-4.29 6 4.29V4.5c0-.28-.224-.5-.5-.5h-11z" />}
                count={0}
                hoverColor="group-hover:text-[#1d9bf0]"
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function LinkedInAction({ icon, label }: { icon: React.ReactNode; label: string }) {
  return (
    <button className="flex flex-1 items-center justify-center gap-1.5 rounded-lg py-3 text-[#71767b] transition-colors hover:bg-[#38434f]/30">
      {icon}
      <span className="text-[13px] font-medium">{label}</span>
    </button>
  );
}

export function LinkedInMockup({ text, profile }: { text: string; profile: Profile }) {
  const [expanded, setExpanded] = useState(false);
  const PREVIEW_LENGTH = 300;
  const hasMore = text.length > PREVIEW_LENGTH;
  const displayText = expanded || !hasMore ? text : text.slice(0, PREVIEW_LENGTH);

  return (
    <div className="rounded-xl overflow-hidden bg-[#1b1f23] border border-[#38434f]">
      <div className="px-4 py-3">
        <div className="mb-3 flex items-start gap-3">
          <div className="flex-shrink-0 pt-0.5">
            <Avatar url={profile.avatarUrl} name={profile.displayName} size={48} bg="bg-[#0A66C2]" />
          </div>
          <div className="min-w-0 flex-1">
            <span className="text-[15px] font-semibold text-[#e7e9ea]">{profile.displayName}</span>
            <p className="truncate text-[13px] text-[#71767b]">{profile.headline}</p>
            <p className="text-[12px] text-[#71767b]">Just now</p>
          </div>
          <svg viewBox="0 0 24 24" className="h-5 w-5 flex-shrink-0 fill-[#0a66c2]">
            <path d="M20.5 2h-17A1.5 1.5 0 002 3.5v17A1.5 1.5 0 003.5 22h17a1.5 1.5 0 001.5-1.5v-17A1.5 1.5 0 0020.5 2zM8 19H5v-9h3zM6.5 8.25A1.75 1.75 0 118.3 6.5a1.78 1.78 0 01-1.8 1.75zM19 19h-3v-4.74c0-1.42-.6-1.93-1.38-1.93A1.74 1.74 0 0013 14.19a.66.66 0 000 .14V19h-3v-9h2.9v1.3a3.11 3.11 0 012.7-1.4c1.55 0 3.36.86 3.36 3.66z" />
          </svg>
        </div>

        <div className="mb-3 whitespace-pre-wrap text-[14px] leading-5 text-[#e7e9ea]">
          {displayText}
          {!expanded && hasMore && (
            <>
              {'... '}
              <button onClick={() => setExpanded(true)} className="text-[#71767b] font-semibold hover:underline">
                more
              </button>
            </>
          )}
        </div>

        <div className="mb-3 flex items-center justify-between text-[12px] text-[#71767b]">
          <div className="flex items-center gap-1">
            <span className="flex -space-x-1">
              <span className="inline-flex h-4 w-4 items-center justify-center rounded-full bg-[#378fe9]">
                <svg viewBox="0 0 16 16" className="h-2.5 w-2.5 fill-white">
                  <path d="M1 7.66c0 3.31 3.09 5.93 6.12 7.98.17.11.36.17.56.17h.13c.2 0 .39-.06.56-.17C11.41 13.59 15 10.97 15 7.66c0-2.67-1.93-4.83-4.3-4.83-1.15 0-2.2.53-2.93 1.37A3.97 3.97 0 004.84 2.83C2.47 2.83 1 4.99 1 7.66z" />
                </svg>
              </span>
              <span className="inline-flex h-4 w-4 items-center justify-center rounded-full bg-[#df704d]">
                <svg viewBox="0 0 16 16" className="h-2.5 w-2.5 fill-white">
                  <path d="M8 2C5.24 2 3 4.24 3 7c0 3.18 4.08 6.54 4.75 7.07.14.11.32.18.5.18s.36-.06.5-.18C9.42 13.54 13 10.18 13 7c0-2.76-2.24-5-5-5z" />
                </svg>
              </span>
              <span className="inline-flex h-4 w-4 items-center justify-center rounded-full bg-[#44712e]">
                <svg viewBox="0 0 16 16" className="h-2.5 w-2.5 fill-white">
                  <path d="M1.64 6.37h1.62a.75.75 0 01.74.75v6.13a.75.75 0 01-.74.75H1.64a.75.75 0 01-.75-.75V7.12a.75.75 0 01.75-.75zm10.38-.85l-.15.15c-.2.21-.44.37-.7.47l-.2.08v-3.1a1.06 1.06 0 00-2.07-.32l-1.47 3.33H5.3v6.87h5.98c.44 0 .83-.28.96-.7l1.7-5.5a.98.98 0 00-.96-1.28h-.96z" />
                </svg>
              </span>
            </span>
            <span>182</span>
          </div>
          <div className="flex gap-3">
            <span>24 comments</span>
            <span>8 reposts</span>
          </div>
        </div>

        <div className="flex border-t border-[#38434f] pt-1">
          <LinkedInAction
            label="Like"
            icon={
              <svg viewBox="0 0 24 24" className="h-5 w-5 fill-current">
                <path d="M19.46 11l-3.91-3.91a7 7 0 01-1.69-2.74l-.49-1.47A2.76 2.76 0 0010.76 1 2.75 2.75 0 008 3.74v1.12a9.19 9.19 0 00.46 2.85L8.89 9H4.12A2.12 2.12 0 002 11.12a2.16 2.16 0 00.92 1.76A2.11 2.11 0 002 14.62a2.14 2.14 0 001.28 2 2 2 0 00-.28 1 2.12 2.12 0 002 2.12v.14A2.12 2.12 0 007.12 22h7.49a8.08 8.08 0 003.58-.84l.31-.16H21V11zM19.5 19.5h-1.2a6.08 6.08 0 01-2.78.5H7.12a.62.62 0 01-.62-.62v-.14a.62.62 0 01.62-.62h1.38v-1.5H7a.62.62 0 010-1.24h1.5v-1.5H6a.62.62 0 010-1.24h1.88v-1.5H4.12a.62.62 0 010-1.24h6.27L9.5 7.27a7.69 7.69 0 01-.5-2.41V3.74A1.25 1.25 0 0110.76 2.5a1.27 1.27 0 011.2.87l.49 1.47a8.5 8.5 0 002.06 3.34l3.49 3.49z" />
              </svg>
            }
          />
          <LinkedInAction
            label="Comment"
            icon={
              <svg viewBox="0 0 24 24" className="h-5 w-5 fill-current">
                <path d="M7 9h10v1.5H7zm0 4h7v1.5H7z" />
                <path d="M20.5 2h-17A1.5 1.5 0 002 3.5v13A1.5 1.5 0 003.5 18H7v4l5-4h8.5a1.5 1.5 0 001.5-1.5v-13A1.5 1.5 0 0020.5 2zm0 14.5H11.5L8.5 19v-2.5h-5v-13h17z" />
              </svg>
            }
          />
          <LinkedInAction
            label="Repost"
            icon={
              <svg viewBox="0 0 24 24" className="h-5 w-5 fill-current">
                <path d="M13.96 5H6c-1.1 0-2 .9-2 2v5.04h2V7h7.96L12 9l1.41 1.41L16.83 7 13.4 3.59 12 5zm-3.92 14H18c1.1 0 2-.9 2-2v-5.04h-2V17h-7.96L12 15l-1.41-1.41L7.17 17l3.42 3.41L12 19z" />
              </svg>
            }
          />
          <LinkedInAction
            label="Send"
            icon={
              <svg viewBox="0 0 24 24" className="h-5 w-5 fill-current">
                <path d="M21 3L0 10l7.66 4.26L20 6l-8.26 12.74L16 22l5-19z" />
              </svg>
            }
          />
        </div>
      </div>
    </div>
  );
}
