import Link from 'next/link';
export default function RepaymentPreview() {
  return (
    <>
      <h1 data-page-heading tabIndex={-1}>
        Record repayment
      </h1>
      <p>
        This preview will support recording a repayment in a later issue. No
        money is moved and no repayment is saved here.
      </p>
      <Link href="/">Back to overview</Link>
    </>
  );
}
