export interface StaffProfile {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  role: string | null;
}

export interface DriverProfile {
  id: string;
  driverCode: string;
  driverType: 'TRUCK' | 'TRAIN';
  firstName: string | null;
  lastName: string | null;
}

export interface LoginChallenge {
  mfaRequired: boolean;
  enrolmentRequired: boolean;
}

export interface TotpEnrolment {
  otpauthUri: string;
  qrDataUrl: string;
  secret: string;
}
