export class PackageError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly cause?: Error,
  ) {
    super(message);
    this.name = 'PackageError';
  }
}

export class PackageNotFoundError extends PackageError {
  constructor(packageName: string) {
    super(`Package ${packageName} not found`, 'PKG_NOT_FOUND');
  }
}

export class PackageInstallError extends PackageError {
  constructor(packageName: string, cause?: Error) {
    super(
      `Failed to install package ${packageName}`,
      'PKG_INSTALL_FAILED',
      cause,
    );
  }
}
