import { Suspense, lazy } from 'react';
import * as Sentry from '@sentry/react';
import { Navigate, createBrowserRouter } from 'react-router-dom';

import { Splash } from '@/shared/components/Splash';

// Dynamic imports: the driver's phone never downloads the admin tree.
const AdminApp = lazy(() => import('@/admin/AdminApp'));
const DriverApp = lazy(() => import('@/driver/DriverApp'));

const sentryCreateBrowserRouter = Sentry.wrapCreateBrowserRouterV7(createBrowserRouter);

export const router = sentryCreateBrowserRouter([
  { path: '/', element: <Navigate to="/admin" replace /> },
  {
    path: '/admin/*',
    element: (
      <Suspense fallback={<Splash />}>
        <AdminApp />
      </Suspense>
    ),
  },
  {
    path: '/driver/*',
    element: (
      <Suspense fallback={<Splash />}>
        <DriverApp />
      </Suspense>
    ),
  },
]);
