import { PersonalFrame } from '@/components/personal/frame';
export default function Layout({ children }: { children: React.ReactNode }) {
  return <PersonalFrame>{children}</PersonalFrame>;
}
