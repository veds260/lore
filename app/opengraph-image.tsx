import { ImageResponse } from 'next/og';

// The link preview. Plain type on the same warm off-white the app uses, so a
// shared trylore.xyz link looks like the product instead of a blank card.

export const alt = 'Lore, an open source CMO that runs on your laptop';
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';

export default function OpengraphImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'space-between',
          background: '#FBFAF7',
          color: '#37352F',
          padding: '72px 80px',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'baseline', fontSize: 64, fontWeight: 700, letterSpacing: '-0.03em' }}>
          lore
          <span style={{ color: '#2383E2' }}>.</span>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column' }}>
          <div style={{ fontSize: 68, lineHeight: 1.1, letterSpacing: '-0.025em', maxWidth: 900 }}>
            An open source CMO that runs on your laptop
          </div>
          <div style={{ marginTop: 28, fontSize: 30, color: '#787774', maxWidth: 860 }}>
            It learns how you write from your own posts, then drafts new ones in that voice
          </div>
        </div>

        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 24, color: '#787774' }}>
          <div style={{ display: 'flex' }}>trylore.xyz</div>
          <div style={{ display: 'flex' }}>AGPL-3.0</div>
        </div>
      </div>
    ),
    size,
  );
}
