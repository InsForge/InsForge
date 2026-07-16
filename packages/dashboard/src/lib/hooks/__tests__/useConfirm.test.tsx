import { act, renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { useConfirm } from '#lib/hooks/useConfirm';

describe('useConfirm', () => {
  it('opens the dialog and resolves to true when confirmed', async () => {
    const { result } = renderHook(() => useConfirm());

    let promise: Promise<boolean>;
    act(() => {
      promise = result.current.confirm({
        title: 'Delete?',
        description: 'Are you sure?',
      });
    });

    expect(result.current.confirmDialogProps.open).toBe(true);

    act(() => {
      result.current.confirmDialogProps.onConfirm();
    });

    await expect(promise!).resolves.toBe(true);
    expect(result.current.confirmDialogProps.open).toBe(false);
  });

  it('opens the dialog and resolves to false when cancelled', async () => {
    const { result } = renderHook(() => useConfirm());

    let promise: Promise<boolean>;
    act(() => {
      promise = result.current.confirm({
        title: 'Delete?',
        description: 'Are you sure?',
      });
    });

    expect(result.current.confirmDialogProps.open).toBe(true);

    act(() => {
      result.current.confirmDialogProps.onOpenChange(false);
    });

    await expect(promise!).resolves.toBe(false);
    expect(result.current.confirmDialogProps.open).toBe(false);
  });

  it('returns the same promise when confirm is called while a dialog is already pending', async () => {
    const { result } = renderHook(() => useConfirm());

    let promise1: Promise<boolean>;
    act(() => {
      promise1 = result.current.confirm({
        title: 'First?',
        description: 'First confirm',
      });
    });

    let promise2: Promise<boolean>;
    act(() => {
      promise2 = result.current.confirm({
        title: 'Second?',
        description: 'Second confirm',
      });
    });

    expect(promise1!).toBe(promise2!);

    // Should honor the first caller's options
    expect(result.current.confirmDialogProps.title).toBe('First?');

    act(() => {
      result.current.confirmDialogProps.onConfirm();
    });

    await expect(promise1!).resolves.toBe(true);
    await expect(promise2!).resolves.toBe(true);
  });

  it('passes confirm options through to confirmDialogProps', () => {
    const { result } = renderHook(() => useConfirm());

    act(() => {
      result.current.confirm({
        title: 'Delete Project',
        description: 'This action is irreversible.',
        confirmText: 'Delete',
        cancelText: 'Cancel',
        destructive: true,
      });
    });

    expect(result.current.confirmDialogProps).toMatchObject({
      open: true,
      title: 'Delete Project',
      description: 'This action is irreversible.',
      confirmText: 'Delete',
      cancelText: 'Cancel',
      destructive: true,
    });
  });

  it('allows a new confirm dialog after the previous one is resolved', async () => {
    const { result } = renderHook(() => useConfirm());

    let promise1: Promise<boolean>;
    act(() => {
      promise1 = result.current.confirm({
        title: 'First?',
        description: 'First confirm',
      });
    });

    act(() => {
      result.current.confirmDialogProps.onConfirm();
    });

    await promise1!;
    expect(result.current.confirmDialogProps.open).toBe(false);

    act(() => {
      promise1 = result.current.confirm({
        title: 'Second?',
        description: 'Second confirm',
      });
    });

    expect(result.current.confirmDialogProps.open).toBe(true);
    expect(result.current.confirmDialogProps.title).toBe('Second?');

    act(() => {
      result.current.confirmDialogProps.onConfirm();
    });

    await expect(promise1!).resolves.toBe(true);
  });

  it('allows a new confirm dialog after the previous one is cancelled', async () => {
    const { result } = renderHook(() => useConfirm());

    let promise1: Promise<boolean>;
    act(() => {
      promise1 = result.current.confirm({
        title: 'First?',
        description: 'First confirm',
      });
    });

    act(() => {
      result.current.confirmDialogProps.onOpenChange(false);
    });

    await promise1!;
    expect(result.current.confirmDialogProps.open).toBe(false);

    act(() => {
      promise1 = result.current.confirm({
        title: 'Second?',
        description: 'Second confirm',
      });
    });

    expect(result.current.confirmDialogProps.open).toBe(true);

    act(() => {
      result.current.confirmDialogProps.onConfirm();
    });

    await expect(promise1!).resolves.toBe(true);
  });

  it('provides default empty title and description before confirm is called', () => {
    const { result } = renderHook(() => useConfirm());

    expect(result.current.confirmDialogProps).toMatchObject({
      open: false,
      title: '',
      description: '',
    });
  });
});
