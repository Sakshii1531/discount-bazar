import React from 'react';
import Modal from './Modal';
import Button from './Button';

/**
 * ConfirmDialog
 *
 * Pair component for the `useConfirmDialog` hook. Built on top of the
 * existing `Modal` primitive so styling is consistent across all admin /
 * seller / delivery panels.
 *
 *   const confirm = useConfirmDialog();
 *
 *   <ConfirmDialog
 *     isOpen={confirm.isOpen}
 *     title={confirm.title}
 *     message={confirm.message}
 *     confirmLabel={confirm.confirmLabel}
 *     cancelLabel={confirm.cancelLabel}
 *     onConfirm={confirm.handleConfirm}
 *     onCancel={confirm.close}
 *     loading={confirm.loading}
 *     variant="danger"
 *   />
 */
const ConfirmDialog = ({
    isOpen,
    onConfirm,
    onCancel,
    title = 'Are you sure?',
    message = '',
    confirmLabel = 'Confirm',
    cancelLabel = 'Cancel',
    loading = false,
    variant = 'primary',
}) => {
    return (
        <Modal
            isOpen={isOpen}
            onClose={onCancel}
            title={title}
            size="sm"
            footer={
                <div className="flex flex-row items-center justify-end gap-2.5 w-full">
                    <Button
                        variant="outline"
                        size="sm"
                        onClick={onCancel}
                        disabled={loading}
                        className="flex-1 sm:flex-initial sm:w-auto h-8 sm:h-9 px-3 sm:px-4 text-xs sm:text-sm font-bold rounded-xl"
                    >
                        {cancelLabel}
                    </Button>
                    <Button
                        variant={variant}
                        size="sm"
                        onClick={onConfirm}
                        isLoading={loading}
                        className="flex-1 sm:flex-initial sm:w-auto h-8 sm:h-9 px-3 sm:px-4 text-xs sm:text-sm font-bold rounded-xl"
                    >
                        {confirmLabel}
                    </Button>
                </div>
            }
        >
            {typeof message === 'string' ? (
                <p className="text-sm text-gray-700 whitespace-pre-wrap">{message}</p>
            ) : (
                message
            )}
        </Modal>
    );
};

export default ConfirmDialog;
