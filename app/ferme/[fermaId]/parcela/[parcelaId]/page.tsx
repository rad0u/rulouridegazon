interface ParcelaPageProps {
  params: {
    parcelaId: string;
  };
}

export default function ParcelaPage({ params }: ParcelaPageProps) {
  return (
    <main style={{ padding: '2rem' }}>
      <h1>Parcelă {params.parcelaId}</h1>
      <p>Istoric operațiuni și formular pentru operațiuni pe parcelă.</p>
    </main>
  );
}
