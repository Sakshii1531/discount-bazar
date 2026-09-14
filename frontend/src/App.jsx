import { Suspense } from 'react';
import AppRouter from '@core/routes/AppRouter';
import { AuthProvider } from '@core/context/AuthContext';
import { SettingsProvider } from '@core/context/SettingsContext';
import { SupportUnreadProvider } from '@core/context/SupportUnreadContext';
import { PendingReviewProvider } from '@core/context/PendingReviewContext';
import SeoHead from '@core/components/SeoHead';
import { ToastProvider } from './shared/components/ui/Toast';
import Loader from './shared/components/ui/Loader';
import ErrorBoundary from './shared/components/ErrorBoundary';
import LenisScroll from './shared/components/LenisScroll';
import OfflineDetector from './shared/components/OfflineDetector';

function App() {
    return (
        <ErrorBoundary>
            <AuthProvider>
                <SettingsProvider>
                    <SeoHead />
                    <ToastProvider>
                        <SupportUnreadProvider>
                            <PendingReviewProvider>
                                <OfflineDetector />
                                <Suspense fallback={<Loader fullScreen />}>
                                    <LenisScroll />
                                    <AppRouter />
                                </Suspense>
                            </PendingReviewProvider>
                        </SupportUnreadProvider>
                    </ToastProvider>
                </SettingsProvider>
            </AuthProvider>
        </ErrorBoundary>
    );
}

export default App;
