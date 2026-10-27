/** Four runic sockets: distinct from mana, capacity, or card-type icons. */
export function RitualGlyph({ family = 'MINOR' }: { family?: 'MINOR' | 'MAJOR' | 'LEGENDARY' }) {
  return <svg className="ritual-glyph" data-family={family} viewBox="0 0 40 40" aria-hidden="true">
    <circle cx="20" cy="20" r="13" fill="none" stroke="currentColor" strokeWidth="1.5" />
    <path d="M20 9L26 20L20 31L14 20Z M14 20H26" fill="none" stroke="currentColor" strokeWidth="1.5" />
    {[0,90,180,270].map(a => <path key={a} transform={`rotate(${a} 20 20)`} d="M20 1L24 5L20 9L16 5Z" fill="currentColor" />)}
  </svg>;
}
