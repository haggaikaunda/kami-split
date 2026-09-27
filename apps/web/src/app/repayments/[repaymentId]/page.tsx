import { RepaymentDetail } from '@/components/repayment/detail';
export default async function Page({
  params,
}: {
  params: Promise<{ repaymentId: string }>;
}) {
  return <RepaymentDetail repaymentId={(await params).repaymentId} />;
}
