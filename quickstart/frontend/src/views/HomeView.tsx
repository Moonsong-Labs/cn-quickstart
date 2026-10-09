// Copyright (c) 2026, Digital Asset (Switzerland) GmbH and/or its affiliates. All rights reserved.
// SPDX-License-Identifier: 0BSD

import type React from 'react';
import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useUserStore } from '../stores/userStore';

const HomeView: React.FC = () => {
  const { user, loading } = useUserStore();
  const navigate = useNavigate();

  useEffect(() => {
    if (!loading && user === null) {
      void navigate('/login');
    }
  }, [user, loading, navigate]);

  if (loading) {
    return null;
  }

  return (
    <main>
      <h1>Home</h1>
    </main>
  );
};

export default HomeView;
