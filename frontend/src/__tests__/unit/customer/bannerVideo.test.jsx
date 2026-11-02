import React from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router-dom';
import ExperienceBannerCarousel from '@modules/customer/components/experience/ExperienceBannerCarousel';

const VIDEO_URL = 'https://res.cloudinary.com/acme/video/upload/v1/banners/promo.mp4';
const POSTER_URL = 'https://res.cloudinary.com/acme/video/upload/q_auto,c_limit,w_1248/v1/banners/promo.jpg';
const IMAGE_URL = 'https://cdn.example.com/banner.png';
const videoBanner = { mediaType: 'video', videoUrl: VIDEO_URL, imageUrl: POSTER_URL, title: 'Promo' };
const imageBanner = { imageUrl: IMAGE_URL, title: 'Sale' };

let intersect;
beforeEach(() => {
  jest.useFakeTimers();
  window.IntersectionObserver = jest.fn((callback) => {
    intersect = (isIntersecting) => act(() => callback([{ isIntersecting }]));
    return { observe: jest.fn(), disconnect: jest.fn() };
  });
  window.HTMLMediaElement.prototype.play = jest.fn(() => Promise.resolve());
  window.HTMLMediaElement.prototype.pause = jest.fn();
});
afterEach(() => {
  jest.useRealTimers();
  delete window.matchMedia;
});

const renderCarousel = (items) =>
  render(
    <MemoryRouter>
      <ExperienceBannerCarousel section={{ title: 'Offers' }} items={items} fullWidth />
    </MemoryRouter>,
  );

describe('video banners', () => {
  it('leaves image banners as plain images', () => {
    renderCarousel([imageBanner]);
    expect(screen.getByAltText('Sale')).toHaveAttribute('src', IMAGE_URL);
    expect(screen.queryByTestId('banner-video')).toBeNull();
  });

  it('requests nothing until the slide is on screen, then plays muted, looped and inline', () => {
    renderCarousel([videoBanner]);
    const video = screen.getByTestId('banner-video');
    expect(video).not.toHaveAttribute('src');
    expect(screen.getByAltText('Promo')).toHaveAttribute('src', POSTER_URL);

    intersect(true);
    expect(video.getAttribute('src')).toContain('/video/upload/q_auto,c_limit,w_1248/v1/banners/promo.mp4');
    expect(video.muted).toBe(true);
    expect(video.loop).toBe(true);
    expect(video.playsInline).toBe(true);
    expect(window.HTMLMediaElement.prototype.play).toHaveBeenCalled();
  });

  it('pauses when scrolled off screen', () => {
    renderCarousel([videoBanner]);
    intersect(true);
    intersect(false);
    expect(window.HTMLMediaElement.prototype.pause).toHaveBeenCalled();
  });

  it('shows the poster and drops the video when it cannot play', () => {
    renderCarousel([videoBanner]);
    intersect(true);
    fireEvent.error(screen.getByTestId('banner-video'));
    expect(screen.queryByTestId('banner-video')).toBeNull();
    expect(screen.getByAltText('Promo')).toBeInTheDocument();
  });

  it('downloads nothing for visitors who prefer reduced motion', () => {
    window.matchMedia = jest.fn(() => ({ matches: true }));
    renderCarousel([videoBanner]);
    intersect(true);
    expect(screen.getByTestId('banner-video')).not.toHaveAttribute('src');
    expect(window.HTMLMediaElement.prototype.play).not.toHaveBeenCalled();
  });

  it('holds a playing video for one full play, not restarting the hold on each loop', () => {
    renderCarousel([videoBanner, imageBanner]);
    const video = screen.getAllByTestId('banner-video')[0];
    intersect(true);
    Object.defineProperty(video, 'duration', { value: 20 });
    Object.defineProperty(video, 'currentTime', { value: 0, writable: true });
    fireEvent.playing(video);

    // The carousel pauses the video as soon as it moves to the next slide.
    const { pause } = window.HTMLMediaElement.prototype;
    act(() => jest.advanceTimersByTime(18000));
    expect(pause).not.toHaveBeenCalled();

    act(() => jest.advanceTimersByTime(1000));
    fireEvent.playing(video); // the browser fires this again when the loop restarts
    expect(pause).not.toHaveBeenCalled();

    act(() => jest.advanceTimersByTime(4500));
    expect(pause).toHaveBeenCalled();
  });

  it('moves on at the usual pace when the video has not started playing', () => {
    renderCarousel([videoBanner, imageBanner]);
    intersect(true);
    act(() => jest.advanceTimersByTime(4500));
    expect(window.HTMLMediaElement.prototype.pause).toHaveBeenCalled();
  });

  it('opens the banner link when the video slide is clicked', () => {
    const Where = () => <output data-testid="where">{useLocation().pathname}</output>;
    render(
      <MemoryRouter>
        <ExperienceBannerCarousel items={[{ ...videoBanner, linkType: 'product', linkValue: 'p1' }]} fullWidth />
        <Where />
      </MemoryRouter>,
    );
    fireEvent.click(screen.getByRole('link', { name: 'Promo' }));
    expect(screen.getByTestId('where')).toHaveTextContent('/product/p1');
  });
});

describe('video banner sound', () => {
  const soundButton = () => screen.queryByTestId('banner-sound-button');

  it('starts muted, and the button turns the sound on and off', () => {
    renderCarousel([videoBanner]);
    expect(soundButton()).toBeNull();
    intersect(true);
    const video = screen.getByTestId('banner-video');
    expect(video.muted).toBe(true);

    fireEvent.click(screen.getByRole('button', { name: 'Turn sound on' }));
    expect(video.muted).toBe(false);
    expect(soundButton()).toHaveAttribute('aria-pressed', 'true');

    fireEvent.click(screen.getByRole('button', { name: 'Turn sound off' }));
    expect(video.muted).toBe(true);
    expect(soundButton()).toHaveAttribute('aria-pressed', 'false');
  });

  it('stays unmuted when playback pauses and resumes', () => {
    renderCarousel([videoBanner]);
    intersect(true);
    const video = screen.getByTestId('banner-video');
    fireEvent.click(soundButton());
    intersect(false);
    intersect(true);
    expect(video.muted).toBe(false);
  });

  it('does not follow the banner link from the button, by click or keyboard', () => {
    const Where = () => <output data-testid="where">{useLocation().pathname}</output>;
    render(
      <MemoryRouter>
        <ExperienceBannerCarousel items={[{ ...videoBanner, linkType: 'product', linkValue: 'p1' }]} fullWidth />
        <Where />
      </MemoryRouter>,
    );
    intersect(true);
    fireEvent.click(soundButton());
    fireEvent.keyDown(soundButton(), { key: 'Enter' });
    expect(screen.getByTestId('where')).toHaveTextContent('/');
    expect(screen.getByTestId('where')).not.toHaveTextContent('product');
  });

  it('hides the button for a video with no sound track', () => {
    renderCarousel([videoBanner]);
    intersect(true);
    const video = screen.getByTestId('banner-video');
    Object.defineProperty(video, 'mozHasAudio', { value: false });
    fireEvent.loadedMetadata(video);
    expect(soundButton()).toBeNull();
    expect(video.loop).toBe(true);
  });

  it('keeps the video playing muted if the browser refuses sound', async () => {
    renderCarousel([videoBanner]);
    intersect(true);
    const video = screen.getByTestId('banner-video');
    window.HTMLMediaElement.prototype.play = jest.fn(function play() {
      return this.muted
        ? Promise.resolve()
        : Promise.reject(Object.assign(new Error('blocked'), { name: 'NotAllowedError' }));
    });
    fireEvent.click(soundButton());
    await act(async () => {});
    expect(video.muted).toBe(true);
    expect(soundButton()).toHaveAttribute('aria-pressed', 'false');
  });

  it('stays on the video for as long as the sound is on', () => {
    renderCarousel([videoBanner, imageBanner]);
    const video = screen.getAllByTestId('banner-video')[0];
    intersect(true);
    Object.defineProperty(video, 'duration', { value: 10 });
    fireEvent.click(soundButton());
    fireEvent.playing(video);
    act(() => jest.advanceTimersByTime(120000));
    expect(window.HTMLMediaElement.prototype.pause).not.toHaveBeenCalled();
    expect(video.muted).toBe(false);
  });

  it('lets a press start the video for visitors who prefer reduced motion, with sound', () => {
    window.matchMedia = jest.fn(() => ({ matches: true }));
    renderCarousel([videoBanner]);
    intersect(true);
    const video = screen.getByTestId('banner-video');
    expect(video).not.toHaveAttribute('src');
    fireEvent.click(soundButton());
    expect(video).toHaveAttribute('src');
    expect(video.muted).toBe(false);
    expect(window.HTMLMediaElement.prototype.play).toHaveBeenCalled();
  });
});
