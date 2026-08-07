import FermaTarlaScreen from './FermaTarlaScreen';

interface FermaPageProps {
  params: Promise<{ fermaId: string }>;
}

export default async function FermaPage({ params }: FermaPageProps) {
  const { fermaId } = await params;
  return <FermaTarlaScreen fermaId={fermaId} />;
}
