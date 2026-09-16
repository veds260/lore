import { redirect } from 'next/navigation';

// Root redirects to marketing landing (served by the (marketing) route group)
export default function RootPage() {
  redirect('/home');
}
