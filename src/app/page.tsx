import { greeting } from '@/lib/greeting';

export default function Home() {
  return (
    <main>
      <p className="eyebrow">Kami Split</p>
      <h1>{greeting()}</h1>
      <p>Shared expenses, simply settled.</p>
    </main>
  );
}
