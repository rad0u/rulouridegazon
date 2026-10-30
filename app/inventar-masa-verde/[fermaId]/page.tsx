import InventarFermaScreen from './InventarFermaScreen';

interface PageProps {
  params: Promise<{ fermaId: string }>;
}

export default async function InventarFermaPage({ params }: PageProps) {
  const { fermaId } = await params;
  return <InventarFermaScreen fermaId={fermaId} />;
}
