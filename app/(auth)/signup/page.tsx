import { redirect } from 'next/navigation';

// Signup and login are the same flow (magic link).
// Redirect to login to keep one canonical auth entry point.
export default function SignupPage() {
  redirect('/login');
}
