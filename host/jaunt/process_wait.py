"""Observe a child exit while retaining its PID until explicit session cleanup."""
import os
import sys

if sys.platform == 'darwin' and not hasattr(os, 'waitid'):
    import ctypes

    # Darwin's public siginfo_t / waitid ABI, on both supported 64-bit CPUs:
    # https://github.com/apple-oss-distributions/xnu/blob/main/bsd/sys/signal.h
    # https://github.com/apple-oss-distributions/xnu/blob/main/bsd/sys/wait.h
    class _Siginfo(ctypes.Structure):
        _fields_ = [('signo', ctypes.c_int), ('error', ctypes.c_int),
                    ('code', ctypes.c_int), ('pid', ctypes.c_int),
                    ('uid', ctypes.c_uint), ('status', ctypes.c_int),
                    ('address', ctypes.c_void_p), ('value', ctypes.c_void_p),
                    ('band', ctypes.c_long), ('reserved', ctypes.c_ulong * 7)]

    _waitid = ctypes.CDLL(None, use_errno=True).waitid
    _waitid.argtypes = [ctypes.c_int, ctypes.c_uint, ctypes.POINTER(_Siginfo), ctypes.c_int]
    _waitid.restype = ctypes.c_int


def exit_status(pid: int) -> int | None:
    if hasattr(os, 'waitid'):
        result = os.waitid(os.P_PID, pid, os.WEXITED | os.WNOHANG | os.WNOWAIT)
        if result is None:
            return None
        return result.si_status if result.si_code == os.CLD_EXITED else -result.si_status
    if sys.platform != 'darwin':
        raise RuntimeError('This platform cannot safely retain shell process ownership')
    result = _Siginfo()
    # P_PID, WEXITED | WNOHANG | WNOWAIT from Darwin's public wait.h.
    if _waitid(1, pid, ctypes.byref(result), 0x04 | 0x01 | 0x20):
        error = ctypes.get_errno()
        raise OSError(error, os.strerror(error))
    if not result.pid:
        return None
    return result.status if result.code == 1 else -result.status
