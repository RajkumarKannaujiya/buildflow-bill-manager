import BillDetail from "@/components/bill-detail";
export default async function BillPage({ params }: { params: Promise<{ id: string }> }) { const { id } = await params; return <BillDetail id={id} />; }
