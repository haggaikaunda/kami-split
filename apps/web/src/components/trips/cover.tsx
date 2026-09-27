'use client';
import { useState } from 'react';
import Image from 'next/image';
import type { Trip } from '@/lib/data/port';
const covers = {
  maui: {
    src: 'https://images.unsplash.com/photo-1616398377801-d6a1a8705c98?auto=format&fit=crop&w=1000&q=80',
    alt: 'Turquoise waves along Maui’s volcanic coastline',
  },
  tahoe: {
    src: 'https://images.unsplash.com/photo-1647285471436-9d1b1e9d6e47?auto=format&fit=crop&w=1000&q=80',
    alt: 'Rocky shores of Lake Tahoe',
  },
};
export function TripCover({ cover }: { cover: Trip['cover'] }) {
  const [failed, setFailed] = useState(false);
  const photo = cover ? covers[cover] : undefined;
  return (
    <div className="trips-cover">
      {photo && !failed ? (
        <Image
          src={photo.src}
          alt={photo.alt}
          width={1000}
          height={400}
          unoptimized
          onError={() => setFailed(true)}
        />
      ) : (
        <div
          className="trips-cover-default"
          aria-label="Abstract trip cover"
          role="img"
        >
          <span aria-hidden="true">◇</span>
        </div>
      )}
    </div>
  );
}
export function TripCredits() {
  return (
    <p className="trips-credits">
      Sample photos:{' '}
      <a href="https://unsplash.com/it/foto/onde-del-mare-che-si-infrangono-sugli-scogli-durante-il-giorno-u5hob7DWLbQ">
        Jordan McQueen / Unsplash (Maui)
      </a>{' '}
      ·{' '}
      <a href="https://unsplash.com/photos/a-rocky-shore-with-clear-blue-water-and-mountains-in-the-background-nNCdDwX-lBY">
        Peter Hulce / Unsplash (Tahoe)
      </a>
      . Abstract covers appear when photos are unavailable.
    </p>
  );
}
